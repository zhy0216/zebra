import { Elysia } from "elysia";
import { type BenchServer, JSON_PAYLOAD, MIDDLEWARE_LAYERS } from "./scenarios.ts";

export async function start(): Promise<BenchServer> {
  const app = new Elysia();

  app.get("/hello", () => "hello world");
  app.get("/user/:id", ({ params }) => params.id);
  app.get("/wild/*", ({ params }) => params["*"] as string);
  app.get("/json", () => JSON_PAYLOAD);

  const layer = () => new Elysia().onRequest(() => {});
  for (let i = 0; i < MIDDLEWARE_LAYERS; i++) {
    app.use(layer());
  }
  app.get("/middleware", () => "middleware ok");

  await app.listen(0);
  const port = app.server?.port ?? 0;
  if (port === 0) throw new Error("elysia did not expose a port");
  return {
    baseUrl: `http://localhost:${port}`,
    stop: async () => {
      app.stop();
    },
  };
}
