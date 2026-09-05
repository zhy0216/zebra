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

async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("request deadline did not settle")), 500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test.each(["resolve", "reject"])(
  "a hung after.request times out once and its late %s cannot complete the request again",
  async (outcome) => {
    const app = new Zebra({ requestTimeout: 20 });
    const gate = Promise.withResolvers<void>();
    const order: string[] = [];
    const errors: unknown[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => {
      unhandled.push(error);
    };
    let signal: AbortSignal | undefined;
    let responses = 0;
    let requestDisposals = 0;
    let sessionDisposals = 0;
    class RequestResource {
      dispose() {
        requestDisposals++;
      }
    }
    class SessionResource {
      dispose() {
        sessionDisposals++;
      }
    }
    app.injectRequest(RequestResource);
    app.injectSession(SessionResource);
    app.get("/", { request: RequestResource, session: SessionResource }, () => new Response("ok"));
    app.on("after.request", async ({ request, response }) => {
      order.push(`after:${response.status}`);
      signal = request.signal;
      await gate.promise;
      order.push(`late:${outcome}`);
      if (outcome === "reject") throw new Error("late completion failure");
    });
    app.on("after.request", () => {
      order.push("next-listener");
    });
    app.on("request.error", ({ error }) => {
      errors.push(error);
      order.push(`error:${(error as HttpError).status}`);
    });
    process.on("unhandledRejection", onUnhandled);
    const pending = app.dispatch(new Request("http://x/")).then((res) => {
      responses++;
      return res;
    });
    try {
      const res = await bounded(pending);
      expect(res.status).toBe(504);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      expect(await res.json()).toMatchObject({
        type: "https://errors.zebra.dev/request_timeout",
        status: 504,
        detail: { limit: 20 },
      });
      expect(signal?.aborted).toBe(true);
      expect(signal?.reason).toBeInstanceOf(HttpError);
      expect(signal?.reason.status).toBe(504);
      expect(order).toEqual(["after:200", "error:504"]);
      expect([requestDisposals, sessionDisposals]).toEqual([1, 1]);
      gate.resolve();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(order).toEqual([
        "after:200",
        "error:504",
        `late:${outcome}`,
        ...(outcome === "resolve" ? ["next-listener"] : []),
      ]);
      expect(errors).toHaveLength(1);
      expect(responses).toBe(1);
      expect([requestDisposals, sessionDisposals]).toEqual([1, 1]);
      expect(unhandled).toEqual([]);
    } finally {
      gate.resolve();
      await pending;
      await app.stop();
      process.off("unhandledRejection", onUnhandled);
    }
  },
);

test("handler and after.request share the original deadline", async () => {
  const app = new Zebra({ requestTimeout: 120 });
  let completion: Promise<void> | undefined;
  let observedStatus: number | undefined;
  let signal: AbortSignal | undefined;
  app.get("/", async () => {
    await Bun.sleep(75);
    return new Response("ok");
  });
  app.on("after.request", ({ request, response }) => {
    observedStatus = response.status;
    signal = request.signal;
    completion = Bun.sleep(75);
    return completion;
  });
  try {
    const res = await bounded(app.dispatch(new Request("http://x/")));
    expect(observedStatus).toBe(200);
    expect(res.status).toBe(504);
    expect(signal?.aborted).toBe(true);
  } finally {
    await completion;
    await app.stop();
  }
});

test("a hung request.error observer after a completion failure cannot bypass the deadline", async () => {
  const app = new Zebra({ requestTimeout: 20 });
  const gate = Promise.withResolvers<void>();
  const failure = new Error("completion failure");
  const errors: unknown[] = [];
  const order: string[] = [];
  app.get("/", () => "ok");
  app.on("after.request", () => {
    order.push("after");
    throw failure;
  });
  app.on("request.error", async ({ error }) => {
    errors.push(error);
    order.push("error");
    await gate.promise;
    throw new Error("late error observer failure");
  });
  const pending = app.dispatch(new Request("http://x/"));
  try {
    const res = await bounded(pending);
    expect(res.status).toBe(504);
    expect(errors).toEqual([failure]);
    gate.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(order).toEqual(["after", "error"]);
  } finally {
    gate.resolve();
    await pending;
    await app.stop();
  }
});

for (const method of ["GET", "HEAD"]) {
  for (const scoped of [false, true]) {
    test.each(["resolve", "reject"])(
      `${method} handler timeout ignores late %s (request scope: ${scoped})`,
      async (outcome) => {
        const app = new Zebra({ requestTimeout: 20 });
        const gate = Promise.withResolvers<void>();
        const order: string[] = [];
        const errors: unknown[] = [];
        let disposals = 0;
        class Resource {
          dispose() {
            disposals++;
          }
        }
        app.injectRequest(Resource);
        app.get("/", scoped ? { resource: Resource } : {}, async () => {
          await gate.promise;
          if (outcome === "reject") throw new Error("late handler failure");
          return "late success";
        });
        app.on("request.error", ({ error }) => {
          errors.push(error);
          order.push("error");
        });
        app.on("after.request", ({ response }) => {
          order.push(`after:${response.status}`);
        });
        const pending = app.dispatch(new Request("http://x/", { method }));
        try {
          const res = await bounded(pending);
          expect(res.status).toBe(504);
          if (method === "HEAD") expect(res.body).toBeNull();
          expect(order).toEqual(["error", "after:504"]);
          expect(disposals).toBe(scoped ? 1 : 0);
          gate.resolve();
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(order).toEqual(["error", "after:504"]);
          expect(errors).toHaveLength(1);
          expect(errors[0]).toBeInstanceOf(HttpError);
          expect(disposals).toBe(scoped ? 1 : 0);
        } finally {
          gate.resolve();
          await pending;
          await app.stop();
        }
      },
    );
  }
}

test("timed out scope cleanup can reject later without replacing the response or repeating events", async () => {
  const app = new Zebra({ requestTimeout: 20 });
  const gate = Promise.withResolvers<void>();
  const order: string[] = [];
  class Resource {
    async dispose() {
      order.push("dispose");
      await gate.promise;
      order.push("cleanup:failed");
      throw new Error("late cleanup failure");
    }
  }
  app.injectRequest(Resource);
  app.get("/", { resource: Resource }, () => "ok");
  app.on("request.error", ({ error }) => {
    order.push(`error:${(error as HttpError).status}`);
  });
  app.on("after.request", ({ response }) => {
    order.push(`after:${response.status}`);
  });
  const pending = app.dispatch(new Request("http://x/"));
  try {
    const res = await bounded(pending);
    expect(res.status).toBe(504);
    expect(order).toEqual(["dispose", "error:504", "after:504"]);
    gate.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(order).toEqual(["dispose", "error:504", "after:504", "cleanup:failed"]);
  } finally {
    gate.resolve();
    await pending;
    await app.stop();
  }
});
