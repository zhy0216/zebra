import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";

test("group prefixes paths", async () => {
  const app = new Zebra({ container: new Container() });
  app.group("/admin", (g) => {
    g.get("/users", async () => ({ list: [] }));
    g.delete("/users/:id", async (req) => ({ deleted: req.params.id }));
  });

  const res = await app.dispatch(new Request("http://x/admin/users"));
  expect(await res.json()).toEqual({ list: [] });

  const del = await app.dispatch(new Request("http://x/admin/users/9", { method: "DELETE" }));
  expect(await del.json()).toEqual({ deleted: "9" });
});

test("group middleware applies only to group routes", async () => {
  const app = new Zebra({ container: new Container() });
  app.get("/outside", async () => "outside");
  app.group("/api", (g) => {
    g.use(async (_req, next) => {
      const r = await next();
      const h = new Headers(r.headers);
      h.set("x-group", "api");
      return new Response(await r.text(), { status: r.status, headers: h });
    });
    g.get("/x", async () => "inside");
  });

  const out = await app.dispatch(new Request("http://x/outside"));
  expect(out.headers.get("x-group")).toBeNull();

  const inn = await app.dispatch(new Request("http://x/api/x"));
  expect(inn.headers.get("x-group")).toBe("api");
});
