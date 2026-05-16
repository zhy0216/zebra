import { test, expect } from "bun:test";
import { ScopeKind, scopeRank, canDependOn } from "../../src/di/scope.ts";
import { keyOf, displayName } from "../../src/di/key.ts";
import { token } from "../../src/di/token.ts";

test("scope ranks order from widest to narrowest", () => {
  expect(scopeRank(ScopeKind.Singleton)).toBe(0);
  expect(scopeRank(ScopeKind.Session)).toBe(1);
  expect(scopeRank(ScopeKind.Request)).toBe(2);
  expect(scopeRank(ScopeKind.Transient)).toBe(3);
});

test("canDependOn: narrower scope may depend on wider, not the reverse", () => {
  expect(canDependOn(ScopeKind.Request, ScopeKind.Singleton)).toBe(true);
  expect(canDependOn(ScopeKind.Singleton, ScopeKind.Request)).toBe(false);
  expect(canDependOn(ScopeKind.Transient, ScopeKind.Session)).toBe(true);
});

test("keyOf returns symbol for token, function for class", () => {
  const T = token("X");
  class C {}
  expect(keyOf(T)).toBe(T.id);
  expect(keyOf(C)).toBe(C);
});

test("displayName uses class name or token name", () => {
  const T = token("MyToken");
  class MyClass {}
  expect(displayName(T)).toBe("MyToken");
  expect(displayName(MyClass)).toBe("MyClass");
});
