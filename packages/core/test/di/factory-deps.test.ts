import { expect, test } from "bun:test";
import { Container } from "../../src/di/container.ts";
import { ScopeKind } from "../../src/di/scope.ts";
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

test("toFactoryWithDeps singleton: factory called once across resolves", () => {
  const T = token<{ n: number }>("T");
  const c = new Container();
  let calls = 0;
  c.bind(T).toFactoryWithDeps({}, () => ({ n: ++calls }));
  c.resolve(T);
  c.resolve(T);
  expect(calls).toBe(1);
});

test("toFactoryWithDeps request scope: factory called once per request child", () => {
  const T = token<{ n: number }>("T");
  const root = new Container();
  let calls = 0;
  root.bind(T).toFactoryWithDeps({}, () => ({ n: ++calls })).inRequestScope();

  const reqA = root.createChildScope(ScopeKind.Request);
  reqA.resolve(T);
  reqA.resolve(T);
  expect(calls).toBe(1);

  const reqB = root.createChildScope(ScopeKind.Request);
  reqB.resolve(T);
  expect(calls).toBe(2);
});

test("toFactoryWithDeps: resolves a class dep alongside a value dep", () => {
  class Helper {
    greet(n: string) { return `hi ${n}`; }
  }
  const Name = token<string>("Name");
  const Out = token<string>("Out");
  const c = new Container();
  c.bind(Helper).toSelf();
  c.bind(Name).toValue("world");
  c.bind(Out).toFactoryWithDeps(
    { h: Helper, name: Name },
    ({ h, name }) => (h as Helper).greet(name as string),
  );
  expect(c.resolve(Out)).toBe("hi world");
});
