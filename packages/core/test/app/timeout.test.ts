import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { HttpError } from "../../src/http/errors.ts";

const HANG = new Promise<never>(() => {});

test("requestTimeout aborts a hung handler and answers 504 Problem+Json", async () => {
  const app = new Zebra({ requestTimeout: 50 });
  let aborted = false;
  app.get("/hang", async (req) => {
    req.signal.addEventListener(
      "abort",
      () => {
        aborted = true;
      },
      { once: true },
    );
    await HANG;
    return new Response("never");
  });
  const { port } = await app.listen({ port: 0 });
  try {
    const res = await fetch(`http://localhost:${port}/hang`);
    expect(res.status).toBe(504);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const problem = (await res.json()) as {
      type: string;
      status: number;
      detail: { limit: number };
    };
    expect(problem.type).toBe("https://errors.zebra.dev/request_timeout");
    expect(problem.status).toBe(504);
    expect(problem.detail.limit).toBe(50);
    expect(aborted).toBe(true);
  } finally {
    await app.stop();
  }
});

test("timeout abort carries the 504 HttpError as signal.reason", async () => {
  const app = new Zebra({ requestTimeout: 50 });
  let reason: unknown;
  app.get("/hang", async (req) => {
    req.signal.addEventListener(
      "abort",
      () => {
        reason = req.signal.reason;
      },
      { once: true },
    );
    await HANG;
    return new Response("never");
  });
  const { port } = await app.listen({ port: 0 });
  try {
    const res = await fetch(`http://localhost:${port}/hang`);
    expect(res.status).toBe(504);
    expect(reason).toBeInstanceOf(HttpError);
    expect((reason as HttpError).status).toBe(504);
    expect((reason as HttpError).code).toBe("request_timeout");
  } finally {
    await app.stop();
  }
});

test("without requestTimeout, req.signal is Bun's raw client-disconnect signal", async () => {
  const app = new Zebra();
  const seen: string[] = [];
  app.get("/abort", async (req) => {
    seen.push(`same:${req.signal === req.raw.signal}`);
    req.signal.addEventListener(
      "abort",
      () => {
        seen.push("abort-fired");
      },
      { once: true },
    );
    await Bun.sleep(300);
    return new Response("never");
  });
  const { port } = await app.listen({ port: 0 });
  const ac = new AbortController();
  const pending = fetch(`http://localhost:${port}/abort`, { signal: ac.signal }).catch(
    (e: Error) => e.name,
  );
  try {
    await Bun.sleep(100);
    ac.abort();
    const outcome = await pending;
    expect(outcome).toBe("AbortError");
    await Bun.sleep(50);
    expect(seen).toContain("same:true");
    expect(seen).toContain("abort-fired");
  } finally {
    await app.stop();
  }
});

test("client abort propagates to the combined signal and the app keeps serving", async () => {
  const app = new Zebra({ requestTimeout: 5_000 });
  let aborted = false;
  const abortedP = new Promise<void>((resolve) => {
    app.get("/abort", async (req) => {
      req.signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          resolve();
        },
        { once: true },
      );
      await HANG;
      return new Response("never");
    });
  });
  const { port } = await app.listen({ port: 0 });
  const ac = new AbortController();
  const pending = fetch(`http://localhost:${port}/abort`, { signal: ac.signal }).catch(
    (e: Error) => e.name,
  );
  try {
    await Bun.sleep(100);
    ac.abort();
    expect(await pending).toBe("AbortError");
    await abortedP;
    expect(aborted).toBe(true);
    // The app is still alive and answers new requests.
    const r = await fetch(`http://localhost:${port}/alive`);
    expect(r.status).toBe(404);
  } finally {
    await app.stop();
  }
});

test("requestTimeout lets graceful shutdown drain a hung handler before the grace period", async () => {
  const app = new Zebra({ requestTimeout: 50, gracePeriod: 10_000 });
  app.get("/hang", async () => HANG);
  const { port } = await app.listen({ port: 0 });
  const pending = fetch(`http://localhost:${port}/hang`);
  await Bun.sleep(10);
  try {
    const started = Date.now();
    await app.stop();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect((await pending).status).toBe(504);
  } finally {
    await app.stop();
  }
});

test("requestTimeout must be positive", () => {
  expect(() => new Zebra({ requestTimeout: 0 })).toThrow(RangeError);
  expect(() => new Zebra({ requestTimeout: -1 })).toThrow(/requestTimeout/);
  expect(() => new Zebra({})).not.toThrow();
});

test("dispatch (no server) respects requestTimeout and exposes the combined signal", async () => {
  const app = new Zebra({ requestTimeout: 50 });
  let aborted = false;
  app.get("/hang", async (req) => {
    req.signal.addEventListener(
      "abort",
      () => {
        aborted = true;
      },
      { once: true },
    );
    await HANG;
    return new Response("never");
  });
  const res = await app.dispatch(new Request("http://x/hang"));
  expect(res.status).toBe(504);
  expect(aborted).toBe(true);
});

test("timeout disposes request scopes and releases the session even for a hung handler", async () => {
  let disposed = false;
  class Scoped {
    dispose(): void {
      disposed = true;
    }
  }
  const app = new Zebra({
    requestTimeout: 50,
    session: { resolver: () => "s1", ttl: 60_000 },
  });
  app.injectRequest(Scoped);
  app.get("/dep", { dep: Scoped }, async () => HANG);
  const res = await app.dispatch(new Request("http://x/dep", { headers: { cookie: "sid=s1" } }));
  expect(res.status).toBe(504);
  // The deadline path disposes the request scope even though the handler never
  // settles, and the session record's activeRequests counter is released.
  expect(disposed).toBe(true);
  // The session scope is released: a second request reuses the same session id
  // and resolves a fresh request-scoped instance without error.
  let secondOk = false;
  app.get("/ok", { dep: Scoped }, async () => {
    secondOk = true;
    return new Response("ok");
  });
  const ok = await app.dispatch(new Request("http://x/ok", { headers: { cookie: "sid=s1" } }));
  expect(ok.status).toBe(200);
  expect(secondOk).toBe(true);
});
