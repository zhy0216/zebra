import { test, expect } from "bun:test";
import { Container } from "../../src/di/container.ts";
import { token } from "../../src/di/token.ts";

test("factory binding gets container, can resolve other deps", () => {
  const Config = token<{ port: number }>("Config");
  const Db = token<{ port: number }>("Db");
  const c = new Container();
  c.bind(Config).toValue({ port: 5432 });
  c.bind(Db).toFactory((ctr) => {
    const cfg = ctr.resolve(Config);
    return { port: cfg.port };
  });
  expect(c.resolve(Db)).toEqual({ port: 5432 });
});

test("factory singleton: called once, result cached", () => {
  const T = token<{ n: number }>("T");
  const c = new Container();
  let calls = 0;
  c.bind(T).toFactory(() => ({ n: ++calls }));
  c.resolve(T);
  c.resolve(T);
  expect(calls).toBe(1);
});
