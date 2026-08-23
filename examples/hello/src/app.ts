import { Zebra } from "@zebra-web/zebra";

/** Composition root: everything main.ts runs, without the listen(). */
export function buildHelloApp(): Zebra {
  const z = new Zebra();
  z.get("/hello/:name", async (req) => new Response(`hello, ${req.params.name}`));
  return z;
}
