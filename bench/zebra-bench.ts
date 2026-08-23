import { join } from "node:path";
import { Zebra, token } from "@zebra-web/zebra";
import { type BenchServer, JSON_PAYLOAD, MIDDLEWARE_LAYERS } from "./scenarios.ts";

const STATIC_ROOT = join(import.meta.dir, "fixtures/static");

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
  app.post("/post-json", async (req) => req.json());

  app.group("", (g) => {
    for (let i = 0; i < MIDDLEWARE_LAYERS; i++) {
      g.use(async (_req, next) => next());
    }
    g.get(
      "/middleware",
      () => new Response("middleware ok", { headers: { "content-type": "text/plain" } }),
    );
  });

  // DI scenario: route deps resolved from the container per request.
  const DiToken = token<{ ok: string }>("bench.di");
  app.injectValue(DiToken, { ok: "ok" });
  app.get("/di", { di: DiToken }, (_req, { di }) => ({ di: di.ok }));

  app.static("/static", STATIC_ROOT, { maxAge: 60 });

  const { port } = await app.listen({ port: 0 });
  return { baseUrl: `http://localhost:${port}`, stop: () => app.stop() };
}
