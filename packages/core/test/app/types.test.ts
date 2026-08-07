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
