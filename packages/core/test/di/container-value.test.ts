import { expect, test } from "bun:test";
import { Container } from "../../src/di/container.ts";
import { UnboundTokenError } from "../../src/di/errors.ts";
import { token } from "../../src/di/token.ts";

test("bind().toValue resolves to the literal", () => {
  const Config = token<{ port: number }>("Config");
  const c = new Container();
  c.bind(Config).toValue({ port: 3000 });
  expect(c.resolve(Config)).toEqual({ port: 3000 });
});

test("singleton resolve returns the same value reference", () => {
  const T = token<{ x: number }>("T");
  const c = new Container();
  const obj = { x: 1 };
  c.bind(T).toValue(obj);
  expect(c.resolve(T)).toBe(c.resolve(T));
});

test("resolve unbound throws UnboundTokenError", () => {
  const Missing = token("Missing");
  const c = new Container();
  expect(() => c.resolve(Missing)).toThrow(UnboundTokenError);
});
