import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { token } from "../../src/di/token.ts";

test("injectValue: bound value resolves via route deps", async () => {
  const Config = token<{ env: string }>("Config");
  const app = new Zebra();
  app.injectValue(Config, { env: "prod" });
  app.get("/env", { cfg: Config }, async (_req, { cfg }) => (cfg as any).env);
  const { port } = await app.listen({ port: 0 });
  const res = await fetch(`http://localhost:${port}/env`);
  expect(await res.text()).toBe('"prod"');
  await app.stop();
});

test("injectValue after listen() throws", async () => {
  const Config = token<{ env: string }>("Config");
  const app = new Zebra();
  app.get("/", async () => "ok");
  await app.listen({ port: 0 });
  expect(() => app.injectValue(Config, { env: "x" })).toThrow(
    /Cannot register bindings after app.listen/,
  );
  await app.stop();
});
