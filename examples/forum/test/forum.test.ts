import { describe, expect, test } from "bun:test";
import { ClientError, createClient } from "@zebra-web/client";
import { buildForumApp } from "../src/app.ts";
import type { ForumAppOptions } from "../src/app.ts";
import { forumContract } from "../src/contract.ts";

// ---------------------------------------------------------------------------
// Integration tests drive the real composition root (buildForumApp) through
// app.dispatch() — same middleware, session signing, rate limiting, contract
// validation and DI as the running server, just without sockets. The cookie
// jar keeps the `sid` cookie across calls so auth flows work like a browser.
// ---------------------------------------------------------------------------

function buildTestApp(opts: ForumAppOptions = { sessionSecret: "test-secret" }) {
  const app = buildForumApp(opts);
  const request = (path: string, init: RequestInit = {}) =>
    app.dispatch(new Request(/^https?:\/\//.test(path) ? path : `http://test.local${path}`, init));
  return { app, request };
}

describe("forum", () => {
  test("register → me → logout → login round-trip", async () => {
    const { request } = buildTestApp();
    const api = createClient(forumContract, { baseUrl: "http://test.local", fetch: jar(request) });

    const registered = await api.auth.register({ body: { username: "ada", password: "hunter2" } });
    expect(registered).toEqual({ id: 1, username: "ada" });

    // register opens the session right away
    expect(await api.auth.me()).toEqual({ id: 1, username: "ada" });

    await api.auth.logout();
    expect(await api.auth.me()).toBeNull();

    await api.auth.login({ body: { username: "ada", password: "hunter2" } });
    expect(await api.auth.me()).toEqual({ id: 1, username: "ada" });
  });

  test("duplicate username → 409 username_taken", async () => {
    const { request } = buildTestApp();
    const api = createClient(forumContract, { baseUrl: "http://test.local", fetch: jar(request) });

    await api.auth.register({ body: { username: "grace", password: "hunter2" } });
    const err = await expectRejected(() =>
      api.auth.register({ body: { username: "grace", password: "other" } }),
    );
    expect(err).toBeInstanceOf(ClientError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("username_taken");
  });

  test("bad credentials → 401 invalid_credentials", async () => {
    const { request } = buildTestApp();
    const api = createClient(forumContract, { baseUrl: "http://test.local", fetch: jar(request) });

    await api.auth.register({ body: { username: "linus", password: "hunter2" } });
    const err = await expectRejected(() =>
      api.auth.login({ body: { username: "linus", password: "nope" } }),
    );
    expect(err.code).toBe("invalid_credentials");
  });

  test("body schema validation → 422 validation_failed", async () => {
    const { request } = buildTestApp();
    const api = createClient(forumContract, { baseUrl: "http://test.local", fetch: jar(request) });

    const err = await expectRejected(
      () => api.auth.register({ body: { username: "x", password: "hunter2" } }), // username min 2
    );
    expect(err.status).toBe(422);
    expect(err.code).toBe("validation_failed");
  });

  test("anonymous writes → 401 unauthorized (requireAuth)", async () => {
    const { request } = buildTestApp();
    const api = createClient(forumContract, { baseUrl: "http://test.local", fetch: jar(request) });

    const err = await expectRejected(() =>
      api.topics.create({ params: { boardId: 1 }, body: { title: "sneaky" } }),
    );
    expect(err.code).toBe("unauthorized");
  });

  test("full write path: topic → posts, with output validation", async () => {
    const { request } = buildTestApp();
    const api = createClient(forumContract, { baseUrl: "http://test.local", fetch: jar(request) });

    await api.auth.register({ body: { username: "dijkstra", password: "hunter2" } });

    const boards = await api.boards.list();
    expect(boards.length).toBeGreaterThan(0);

    const topic = await api.topics.create({
      params: { boardId: boards[0]!.id },
      body: { title: "Zebra is great" },
    });
    expect(topic.postCount).toBe(0);
    expect(topic.author).toBe("dijkstra");

    const post = await api.posts.create({
      params: { topicId: topic.id },
      body: { content: "first!" },
    });
    expect(post.author).toBe("dijkstra");

    const { items, total } = await api.topics.list({
      params: { boardId: topic.boardId },
      query: { page: 1 },
    });
    expect(total).toBe(1);
    expect(items[0]!.id).toBe(topic.id);
    expect(items[0]!.postCount).toBe(1); // createPost bumped the counter

    const posts = await api.posts.list({ params: { topicId: topic.id } });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.content).toBe("first!");
  });

  test("unknown board/topic → 404 problem", async () => {
    const { request } = buildTestApp();
    const api = createClient(forumContract, { baseUrl: "http://test.local", fetch: jar(request) });
    await api.auth.register({ body: { username: "hopper", password: "hunter2" } });

    const missingBoard = await expectRejected(() =>
      api.topics.create({ params: { boardId: 999 }, body: { title: "nope" } }),
    );
    expect(missingBoard.status).toBe(404);
    expect(missingBoard.code).toBe("board_not_found");

    const missingTopic = await expectRejected(() => api.posts.list({ params: { topicId: 999 } }));
    expect(missingTopic.code).toBe("topic_not_found");
  });

  test("anonymous session: me is null until login", async () => {
    const { request } = buildTestApp();
    const api = createClient(forumContract, { baseUrl: "http://test.local", fetch: jar(request) });

    expect(await api.auth.me()).toBeNull();

    await api.auth.register({ body: { username: "lovelace", password: "hunter2" } });
    expect(await api.auth.me()).toEqual({ id: 1, username: "lovelace" });
  });
});

/** Catches a rejected promise and returns the ClientError for assertions. */
async function expectRejected<T>(fn: () => Promise<T>): Promise<ClientError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ClientError) return err;
    throw err;
  }
  throw new Error("expected the call to reject with a ClientError");
}

/** fetch wrapper that persists the signed `sid` cookie between calls. */
function jar(request: (path: string, init?: RequestInit) => Promise<Response>) {
  let cookie = "";
  return async (url: string, init: RequestInit): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (cookie !== "") headers.set("cookie", cookie);
    const res = await request(url, { ...init, headers });
    const set = res.headers.get("set-cookie");
    if (set !== null) cookie = `${set.split(";")[0]};`;
    return res;
  };
}
