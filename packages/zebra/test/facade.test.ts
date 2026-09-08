import { expect, expectTypeOf, test } from "bun:test";
import * as core from "@zebra-web/core";
import * as cors from "@zebra-web/cors";
import * as rateLimit from "@zebra-web/rate-limit";
import * as session from "@zebra-web/session";

import * as facade from "../src/index.ts";

test("facade re-exports the full core, cors and session surfaces", () => {
  for (const key of Object.keys(core)) {
    expect(key in facade, `missing core export ${key}`).toBe(true);
  }
  for (const key of Object.keys(cors)) {
    expect(key in facade, `missing cors export ${key}`).toBe(true);
  }
  for (const key of Object.keys(session)) {
    expect(key in facade, `missing session export ${key}`).toBe(true);
  }
});

test("rate-limit exports are present with the documented aliases", () => {
  expect(facade.rateLimit).toBe(rateLimit.rateLimit);
  expect(facade.createLimiter).toBe(rateLimit.createLimiter);
  expect(facade.checkLimit).toBe(rateLimit.checkLimit);
  // MemoryStore collides with session's re-export and is aliased (frozen,
  // documented in docs/api-freeze.md §3 "zebra").
  expect(facade.RateLimitMemoryStore).toBe(rateLimit.MemoryStore);
  // RateLimitMemoryStoreOptions is a type-only alias (erases at runtime), so it
  // cannot be compared with `.toBe(...)` — verify the alias resolves to the
  // same type instead. Surfaced by the native-compiler migration, which
  // typechecks this test file.
  expectTypeOf<facade.RateLimitMemoryStoreOptions>().toEqualTypeOf<rateLimit.MemoryStoreOptions>();
  expect(facade.MemoryStore).toBe(session.MemoryStore);
});

test("event system exports are re-exported by the facade", () => {
  expect(facade.EventBus).toBe(core.EventBus);
  expect(facade.EventEmitter).toBe(core.EventEmitter);
  // Type-level exports are part of the surface even though they erase at runtime;
  // the value exports above are checked at runtime, the rest are type-checked.
});

test("WebSocket control and transport types are public through core and facade", () => {
  expect(facade.wsUpgrade).toBe(core.wsUpgrade);
  expectTypeOf<facade.WsUpgrade<{ id: number }>>().toEqualTypeOf<core.WsUpgrade<{ id: number }>>();
  expectTypeOf<facade.WsUpgradeOptions>().toEqualTypeOf<core.WsUpgradeOptions>();
  expectTypeOf<facade.WsTransportOptions>().toEqualTypeOf<core.WsTransportOptions>();
  const app = new facade.Zebra();
  app.ws("/typed", {
    upgrade: (req) =>
      req.headers.has("reject")
        ? new Response("no", { status: 403 })
        : facade.wsUpgrade({ userId: "u1" }, { headers: { "x-accepted": "yes" } }),
    message(_ws, data) {
      expectTypeOf(data.userId).toEqualTypeOf<string>();
    },
  });
  expectTypeOf<facade.ListenOptions["websocket"]>().toEqualTypeOf<
    core.WsTransportOptions | undefined
  >();
});

test("facade exposes prepare for in-process HTTP dispatch", async () => {
  const app = new facade.Zebra();
  let boots = 0;
  app.on("boot", () => {
    boots++;
  });
  app.get("/hello/:id", (req) => req.params.id);
  try {
    expectTypeOf(app.prepare).returns.toEqualTypeOf<Promise<void>>();
    await app.prepare();
    await app.prepare();
    const response = await app.dispatch(new Request("http://local/hello/42"));
    expect(await response.json()).toBe("42");
    expect(boots).toBe(1);
  } finally {
    await app.stop();
  }
});

test.each([{}, { signalHandlers: true }, { signalHandlers: false }])(
  "facade exposes optional signal ownership: %j",
  async (options: facade.ZebraOptions) => {
    expectTypeOf<facade.ZebraOptions>().toEqualTypeOf<core.ZebraOptions>();
    expectTypeOf<facade.ZebraOptions["signalHandlers"]>().toEqualTypeOf<boolean | undefined>();
    const app = new facade.Zebra(options);
    const signals = ["SIGINT", "SIGTERM"] as const;
    const before = signals.map((signal) => process.rawListeners(signal));
    try {
      await app.prepare();
      expect(signals.map((signal) => process.rawListeners(signal))).toEqual(before);
      await app.listen({ port: 0 });
      signals.forEach((signal, index) => {
        expect(process.listenerCount(signal)).toBe(
          before[index]!.length + (options.signalHandlers === false ? 0 : 1),
        );
      });
      await app.stop();
      expect(signals.map((signal) => process.rawListeners(signal))).toEqual(before);
    } finally {
      await app.stop();
    }
  },
);

test("contract / client / testing / observability / redis are not re-exported", () => {
  // Kept out of the facade on purpose (tree-shakeable facade, see the freeze
  // doc); import them from their own packages.
  for (const key of ["zc", "createClient", "createTestApp", "requestId", "RedisRateLimitStore"]) {
    expect(key in facade).toBe(false);
  }
});
