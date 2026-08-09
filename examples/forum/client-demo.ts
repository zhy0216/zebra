import { ClientError, createClient } from "@zebra/client";
import { forumContract } from "./src/contract.ts";

// ---------------------------------------------------------------------------
// The typed client derives everything from the contract — no server code.
// The cookie jar keeps the `sid` cookie across calls so login persists.
//
// Run after the server:  bun --filter example-forum start
// Then:                  bun --filter example-forum client
// ---------------------------------------------------------------------------

let jar = "";
function cookieFetch(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (jar !== "") headers.set("cookie", jar);
  return fetch(url, { ...init, headers }).then((res) => {
    const set = res.headers.get("set-cookie");
    if (set !== null) jar = `${set.split(";")[0]};`;
    return res;
  });
}

const api = createClient(forumContract, {
  baseUrl: "http://localhost:3002",
  fetch: cookieFetch,
});

const USERNAME = `alice_${Date.now() % 100000}`;

// auth round-trip ------------------------------------------------------------
const created = await api.auth.register({ body: { username: USERNAME, password: "hunter2" } });
console.log("registered:", created.username);

console.log("me (logged in):", JSON.stringify(await api.auth.me()));

await api.auth.logout();
console.log("me (after logout):", JSON.stringify(await api.auth.me()));

const loggedIn = await api.auth.login({ body: { username: USERNAME, password: "hunter2" } });
console.log("logged back in as:", loggedIn.username);

try {
  await api.auth.login({ body: { username: USERNAME, password: "wrong" } });
} catch (err) {
  console.log("bad password ->", err instanceof ClientError ? `${err.status} ${err.code}` : err);
}

// forum round-trip -----------------------------------------------------------
const boards = await api.boards.list();
console.log("boards:", boards.map((b) => b.name).join(", "));

const topic = await api.topics.create({
  params: { boardId: boards[0]!.id },
  body: { title: "Contract-first forums are nice" },
});
console.log("created topic:", topic.title);

const { items, total } = await api.topics.list({
  params: { boardId: topic.boardId },
  query: { page: 1 },
});
console.log(`topics in board #${topic.boardId}: ${total} (first: "${items[0]?.title}")`);

const post = await api.posts.create({
  params: { topicId: topic.id },
  body: { content: "hello from the typed client" },
});
console.log("posted by", post.author, "->", post.content);

const posts = await api.posts.list({ params: { topicId: topic.id } });
console.log("posts in topic:", posts.length);

// anonymous writes are rejected ---------------------------------------------
await api.auth.logout();
try {
  await api.topics.create({ params: { boardId: 1 }, body: { title: "should fail" } });
} catch (err) {
  console.log("anonymous write ->", err instanceof ClientError ? `${err.status} ${err.code}` : err);
}

console.log("done — open http://localhost:3002 for the browser frontend");
