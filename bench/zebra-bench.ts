import { Zebra } from "zebra";
import { type BenchServer, JSON_PAYLOAD, MIDDLEWARE_LAYERS } from "./scenarios.ts";

export async function start(): Promise<BenchServer> {
  const app = new Zebra();

  app.get(
    "/hello",
    () => new Response("hello world", { headers: { "content-type": "text/plain" } }),
  );
  app.get(
    "/user/:id",
    (req) => new Response(req.params.id, { headers: { "content-type": "text/plain" } }),
  );
  app.get(
    "/wild/*tail",
    (req) => new Response(req.params.tail, { headers: { "content-type": "text/plain" } }),
  );
  app.get("/json", () => JSON_PAYLOAD);

  app.group("", (g) => {
    for (let i = 0; i < MIDDLEWARE_LAYERS; i++) {
      g.use(async (_req, next) => next());
    }
    g.get(
      "/middleware",
      () => new Response("middleware ok", { headers: { "content-type": "text/plain" } }),
    );
  });

  const { port } = await app.listen({ port: 0 });
  return { baseUrl: `http://localhost:${port}`, stop: () => app.stop() };
}
