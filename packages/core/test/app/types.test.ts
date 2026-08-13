import { expectTypeOf, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { token } from "../../src/di/token.ts";
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
