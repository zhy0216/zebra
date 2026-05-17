import { expect, test } from "bun:test";
import { Container } from "../../src/di/container.ts";
import { token } from "../../src/di/token.ts";

test("toFactoryWithDeps: factory receives resolved deps object, not container", () => {
  const Config = token<{ url: string }>("Config");
  const Db = token<{ url: string }>("Db");
  const c = new Container();
  c.bind(Config).toValue({ url: "postgres://x" });
  c.bind(Db).toFactoryWithDeps({ config: Config }, ({ config }) => ({ url: (config as { url: string }).url }));
  expect(c.resolve(Db)).toEqual({ url: "postgres://x" });
});

test("toFactoryWithDeps: factory NOT called with container arg", () => {
  const T = token<{ ok: boolean }>("T");
  const c = new Container();
  c.bind(T)
    .toFactoryWithDeps({}, (arg) => {
      // Factory must receive an object (the resolved deps), not the Container itself
      const isContainer = typeof (arg as any)?.resolve === "function";
      return { ok: !isContainer };
    });
  expect(c.resolve(T).ok).toBe(true);
});
