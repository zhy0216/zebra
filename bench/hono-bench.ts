import { join } from "node:path";
import { Hono, type MiddlewareHandler } from "hono";
import { type BenchServer, JSON_PAYLOAD, MIDDLEWARE_LAYERS } from "./scenarios.ts";

const STATIC_ROOT = join(import.meta.dir, "fixtures/static");

export async function start(): Promise<BenchServer> {
  const app = new Hono();

  app.get("/hello", (c) => c.text("hello world"));
  app.get("/user/:id", (c) => c.text(c.req.param("id") ?? ""));
  app.get("/wild/*", (c) => c.text(c.req.path.slice("/wild/".length)));
  app.get("/json", (c) => c.json(JSON_PAYLOAD));
  app.get("/di", (c) => c.json({ di: "ok" }));
  app.get(
    "/static/*",
    (c) => new Response(Bun.file(join(STATIC_ROOT, c.req.path.slice("/static/".length)))),
  );

  const mw: MiddlewareHandler = async (_c, next) => next();
  for (let i = 0; i < MIDDLEWARE_LAYERS; i++) {
    app.use("/middleware", mw);
  }
  app.get("/middleware", (c) => c.text("middleware ok"));

  const server = Bun.serve({ port: 0, fetch: app.fetch });
  return {
    baseUrl: `http://localhost:${server.port}`,
    stop: async () => {
      server.stop(true);
    },
  };
}
