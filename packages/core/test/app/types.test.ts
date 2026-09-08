import { expectTypeOf, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { token } from "../../src/di/token.ts";
import {
  type ListenOptions,
  type WsHandler,
  type WsTransportOptions,
  type WsUpgrade,
  wsUpgrade,
} from "../../src/index.ts";
test("route and nested-group params plus deps are inferred from declarations", () => {
  const app = new Zebra();
  const Name = token<string>("Name");
  app.injectValue(Name, "zebra");

  app.get("/blogs/:id/*rest", { name: Name }, (req, { name }) => {
    expectTypeOf(req.params).toEqualTypeOf<{ id: string; rest: string }>();
    expectTypeOf(name).toEqualTypeOf<string>();
    return name;
  });

  app.group("/orgs/:org", (group) => {
    group.group("/users", (users) => {
      users.get("/:id", (req) => {
        expectTypeOf(req.params).toEqualTypeOf<{ org: string; id: string }>();
        return req.params.id;
      });
    });
  });
});

test("wsUpgrade and Response preserve inferred data and DI types across every callback", () => {
  const app = new Zebra();
  const Name = token<string>("Name");
  app.injectValue(Name, "u1");
  app.ws("/typed", {
    onUpgrade: { name: Name },
    async upgrade(req, { name }) {
      expectTypeOf(name).toEqualTypeOf<string>();
      if (req.headers.has("reject")) return new Response("no", { status: 403 });
      if (req.headers.has("legacy-reject")) return false;
      const data = { userId: name, ts: 1, data: "ordinary data", headers: 42 };
      return req.headers.has("plain")
        ? data
        : wsUpgrade(data, { headers: { "x-accepted": "yes" } });
    },
    open(ws, data) {
      expectTypeOf(data.userId).toEqualTypeOf<string>();
      expectTypeOf(ws.data.ts).toEqualTypeOf<number>();
      expectTypeOf(data.data).toEqualTypeOf<string>();
      expectTypeOf(data.headers).toEqualTypeOf<number>();
    },
    message(ws, data, msg) {
      expectTypeOf(data.userId).toEqualTypeOf<string>();
      expectTypeOf(ws.data.ts).toEqualTypeOf<number>();
      expectTypeOf(msg).toEqualTypeOf<string | Buffer>();
    },
    close(_ws, data, code, reason) {
      expectTypeOf(data.userId).toEqualTypeOf<string>();
      expectTypeOf(code).toEqualTypeOf<number>();
      expectTypeOf(reason).toEqualTypeOf<string>();
    },
    drain(ws, data) {
      expectTypeOf(ws.data.userId).toEqualTypeOf<string>();
      expectTypeOf(data.ts).toEqualTypeOf<number>();
    },
    ping(_ws, data, payload) {
      expectTypeOf(data.userId).toEqualTypeOf<string>();
      expectTypeOf(payload).toEqualTypeOf<Buffer>();
    },
    pong(_ws, data, payload) {
      expectTypeOf(data.userId).toEqualTypeOf<string>();
      expectTypeOf(payload).toEqualTypeOf<Buffer>();
    },
  });
  app.ws("/sync", {
    upgrade: () => wsUpgrade({ userId: "u1" }),
    open(_ws, data) {
      expectTypeOf(data.userId).toEqualTypeOf<string>();
    },
  });
  app.ws("/rejection-only", { upgrade: () => new Response("no", { status: 403 }) });
  const explicit: WsHandler<never, { userId: string }> = {
    upgrade: () => wsUpgrade({ userId: "u1" }),
  };
  app.ws("/explicit", explicit);
  expectTypeOf(wsUpgrade({ id: 1 })).toEqualTypeOf<WsUpgrade<{ id: number }>>();
  // @ts-expect-error Successful control results cannot be forged with ordinary string keys.
  const unbranded: WsUpgrade<{ id: number }> = { data: { id: 1 }, headers: {} };
  void unbranded;
  // @ts-expect-error Headers must use Bun's HeadersInit, not arbitrary application data.
  wsUpgrade({}, { headers: 42 });
});

test("listen exposes only typed WebSocket transport settings", () => {
  const options: ListenOptions = {
    port: 0,
    websocket: {
      maxPayloadLength: 1024 * 1024,
      idleTimeout: 0,
      backpressureLimit: 4096,
      closeOnBackpressureLimit: true,
    },
  };
  expectTypeOf(options.websocket).toEqualTypeOf<WsTransportOptions | undefined>();
  // @ts-expect-error Callbacks belong to app.ws, not listen.
  const callback: WsTransportOptions = { message() {} };
  // @ts-expect-error Connection data cannot override Zebra's dispatch data.
  const data: WsTransportOptions = { data: { user: "u1" } };
  // @ts-expect-error Transport limits are numbers, not strings.
  const limit: WsTransportOptions = { maxPayloadLength: "1 MiB" };
  // @ts-expect-error Overflow behavior is a boolean.
  const overflow: WsTransportOptions = { closeOnBackpressureLimit: 1 };
  void [callback, data, limit, overflow];
});

test("ws open/message/close: upgrade fields are typed via Up, Bun params stay in order", () => {
  const app = new Zebra();
  app.ws("/chat/:room", {
    upgrade: () => ({ userId: "u1", ts: 1 }),
    open(ws, data) {
      expectTypeOf(data.params).toEqualTypeOf<Record<string, string>>();
      expectTypeOf(data.userId).toEqualTypeOf<string>();
      expectTypeOf(data.ts).toEqualTypeOf<number>();
      expectTypeOf(ws.send).toBeFunction();
    },
    message(_ws, data, msg) {
      expectTypeOf(data.userId).toEqualTypeOf<string>();
      expectTypeOf(msg).toEqualTypeOf<string | Buffer>();
    },
    close(_ws, data, code, reason) {
      expectTypeOf(data.userId).toEqualTypeOf<string>();
      expectTypeOf(code).toEqualTypeOf<number>();
      expectTypeOf(reason).toEqualTypeOf<string>();
    },
  });

  app.ws("/plain", {
    open(_ws, data) {
      expectTypeOf(data.params).toEqualTypeOf<Record<string, string>>();
    },
  });
});
