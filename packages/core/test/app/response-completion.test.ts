import "reflect-metadata";
import { expect, test } from "bun:test";
import { MemoryStore, getSession, sessionMiddleware } from "../../../session/src/index.ts";
import { Zebra } from "../../src/app/app.ts";
import { HttpError } from "../../src/http/errors.ts";

async function promptly<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("response did not complete")), 500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test.each(["explicit", "fallback", "middleware"])(
  "HEAD %s preserves response metadata and cancels the discarded stream once",
  async (source) => {
    const app = new Zebra();
    let cancels = 0;
    let pulls = 0;
    let getCalls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulls++;
        },
        cancel() {
          cancels++;
        },
      },
      { highWaterMark: 0 },
    );
    const response = () =>
      new Response(body, {
        status: 203,
        statusText: "Custom status",
        headers: [
          ["content-type", "text/plain"],
          ["content-length", "7"],
          ["etag", '"version-1"'],
          ["set-cookie", "a=1; Path=/"],
          ["set-cookie", "b=2; Path=/"],
        ],
      });
    if (source === "explicit") {
      app.head("/", response);
      app.get("/", () => {
        getCalls++;
        return "get";
      });
    } else if (source === "fallback") {
      app.get("/", response);
    } else {
      app.use(async () => response());
    }
    const observedBodies: Array<ReadableStream | null> = [];
    app.on("after.request", ({ response }) => {
      observedBodies.push(response.body);
      response.headers.set("x-completed", "yes");
    });
    try {
      const res = await promptly(app.dispatch(new Request("http://x/", { method: "HEAD" })));
      expect(res.body).toBeNull();
      expect(res.status).toBe(203);
      expect(res.statusText).toBe("Custom status");
      expect(res.headers.get("content-type")).toBe("text/plain");
      expect(res.headers.get("content-length")).toBe("7");
      expect(res.headers.get("etag")).toBe('"version-1"');
      expect(res.headers.get("x-completed")).toBe("yes");
      expect(res.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
      expect(observedBodies).toEqual([null]);
      expect(cancels).toBe(1);
      expect(pulls).toBe(0);
      expect(getCalls).toBe(0);
    } finally {
      if (cancels === 0) await body.cancel();
      await app.stop();
    }
  },
);

test.each(["throw", "reject", "pending"])(
  "HEAD completes when stream cancellation is %s",
  async (mode) => {
    const app = new Zebra();
    const gate = Promise.withResolvers<void>();
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => {
      unhandled.push(error);
    };
    let cancels = 0;
    const body = new ReadableStream(
      {
        cancel() {
          cancels++;
          if (mode === "throw") throw new Error("cancel threw");
          if (mode === "reject") return Promise.reject(new Error("cancel rejected"));
          return gate.promise;
        },
      },
      { highWaterMark: 0 },
    );
    app.get("/", () => new Response(body));
    process.on("unhandledRejection", onUnhandled);
    const pending = app.dispatch(new Request("http://x/", { method: "HEAD" }));
    try {
      const res = await promptly(pending);
      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
      expect(cancels).toBe(1);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      gate.resolve();
      await pending;
      if (cancels === 0) await body.cancel().catch(() => {});
      await app.stop();
      process.off("unhandledRejection", onUnhandled);
    }
  },
);

test("GET leaves a streaming response readable without cancelling or pre-reading it", async () => {
  const app = new Zebra();
  let cancels = 0;
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls++;
        controller.enqueue(new TextEncoder().encode("streamed"));
        controller.close();
      },
      cancel() {
        cancels++;
      },
    },
    { highWaterMark: 0 },
  );
  app.get("/", () => new Response(body));
  app.on("after.request", () => {});
  try {
    const res = await app.dispatch(new Request("http://x/"));
    expect(res.body).toBe(body);
    expect(pulls).toBe(0);
    expect(cancels).toBe(0);
    expect(await res.text()).toBe("streamed");
    expect(pulls).toBe(1);
    expect(cancels).toBe(0);
  } finally {
    await body.cancel();
    await app.stop();
  }
});

test.each(["handler", "middleware", "before", "after"])(
  "HEAD removes the body of a %s failure",
  async (source) => {
    const app = new Zebra();
    const fail = () => {
      throw new HttpError(503, "unavailable", "Unavailable");
    };
    app.head("/", source === "handler" ? fail : () => new Response("ok"));
    if (source === "middleware") app.use(async () => fail());
    if (source === "before") app.on("before.request", fail);
    if (source === "after") app.on("after.request", fail);
    try {
      const res = await app.dispatch(new Request("http://x/", { method: "HEAD" }));
      expect(res.status).toBe(503);
      expect(res.body).toBeNull();
      expect(res.headers.get("content-type")).toContain("application/problem+json");
    } finally {
      await app.stop();
    }
  },
);

for (const method of ["GET", "HEAD"]) {
  for (const handlerFails of [false, true]) {
    test.each(["reject", "timeout"])(
      `${method} preserves session cookies when completion is %s (handler fails: ${handlerFails})`,
      async (completion) => {
        const store = new MemoryStore({ ttl: 60_000 });
        const middleware = sessionMiddleware({ secret: "completion-test-secret", store });
        const app = new Zebra({
          session: { resolver: middleware.resolver },
          ...(completion === "timeout" ? { requestTimeout: 30 } : {}),
        });
        const gate = Promise.withResolvers<void>();
        const preference = "preference=light; Path=/";
        let sessionId = "";
        const order: string[] = [];
        let cookies: string[] = [];
        app.use(middleware);
        app.get("/", async (req) => {
          const session = getSession(req)!;
          sessionId = session.id;
          await session.set("user", "Ada");
          if (handlerFails) {
            throw new HttpError(409, "conflict", "Conflict", undefined, {
              "set-cookie": preference,
            });
          }
          return new Response("ok", { headers: { "set-cookie": preference } });
        });
        app.on("request.error", ({ error }) => {
          order.push(`error:${error instanceof HttpError ? error.status : 500}`);
        });
        app.on("after.request", ({ response }) => {
          order.push(`after:${response.status}`);
          cookies = response.headers.getSetCookie();
          if (completion === "timeout") return gate.promise;
          throw new Error("completion failed");
        });
        const pending = app.dispatch(new Request("http://x/", { method }));
        try {
          const res = await promptly(pending);
          expect(res.status).toBe(completion === "timeout" ? 504 : handlerFails ? 409 : 500);
          expect(res.headers.get("content-type")).toContain("application/problem+json");
          if (method === "HEAD") expect(res.body).toBeNull();
          expect(cookies).toHaveLength(2);
          expect(cookies).toContain(preference);
          expect(cookies.some((cookie) => cookie.startsWith(`sid=${sessionId}.`))).toBe(true);
          expect(res.headers.getSetCookie().sort()).toEqual(cookies.sort());
          expect(await store.get(sessionId)).toEqual({ user: "Ada" });
          expect(order).toEqual(
            handlerFails
              ? ["error:409", "after:409"]
              : ["after:200", `error:${completion === "timeout" ? 504 : 500}`],
          );
        } finally {
          gate.resolve();
          await pending;
          await app.stop();
        }
      },
    );
  }
}

test.each([200, 401, 503])(
  "cleanup after handler status %d reports one error and disposes each resource once",
  async (status) => {
    const app = new Zebra();
    const order: string[] = [];
    const errors: unknown[] = [];
    const cleanupErrors = [new Error("request cleanup"), new Error("session cleanup")];
    const original = status === 200 ? undefined : new HttpError(status, "original", "Original");
    class RequestResource {
      dispose() {
        order.push("dispose:request");
        throw cleanupErrors[0];
      }
    }
    class SessionResource {
      async dispose() {
        order.push("dispose:session");
        throw cleanupErrors[1];
      }
    }
    app.injectRequest(RequestResource);
    app.injectSession(SessionResource);
    app.get("/", { request: RequestResource, session: SessionResource }, () => {
      order.push("handler");
      if (original) throw original;
      return "ok";
    });
    app.on("request.error", ({ error }) => {
      order.push("error");
      errors.push(error);
    });
    app.on("after.request", ({ response }) => {
      order.push(`after:${response.status}`);
      throw new Error("completion failed too");
    });
    try {
      const res = await app.dispatch(new Request("http://x/"));
      expect(res.status).toBe(status === 200 ? 500 : status);
      expect(errors).toHaveLength(1);
      if (original) expect(errors[0]).toBe(original);
      else {
        expect(errors[0]).toBeInstanceOf(AggregateError);
        expect((errors[0] as AggregateError).errors).toEqual(cleanupErrors);
      }
      await app.stop();
      expect(order).toEqual([
        "handler",
        "dispose:request",
        "dispose:session",
        "error",
        `after:${res.status}`,
      ]);
    } finally {
      await app.stop();
    }
  },
);
