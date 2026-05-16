import "reflect-metadata";
import { test, expect } from "bun:test";
import { Container } from "../../src/di/container.ts";
import { token } from "../../src/di/token.ts";

test("rebind replaces an existing binding", () => {
  const T = token<string>("T");
  const c = new Container();
  c.bind(T).toValue("real");
  expect(c.resolve(T)).toBe("real");
  c.rebind(T).toValue("mock");
  expect(c.resolve(T)).toBe("mock");
});

test("snapshot/restore round-trips bindings", () => {
  const T = token<string>("T");
  const c = new Container();
  c.bind(T).toValue("a");
  c.snapshot();
  c.rebind(T).toValue("b");
  expect(c.resolve(T)).toBe("b");
  c.restore();
  expect(c.resolve(T)).toBe("a");
});
