import { expect, test } from "bun:test";
import { type Token, isToken, token } from "../../src/di/token.ts";

test("token() creates a token with a unique symbol id and name", () => {
  const Db = token<{ query(): unknown }>("Db");
  expect(Db.name).toBe("Db");
  expect(typeof Db.id).toBe("symbol");
});

test("two tokens with the same name are distinct", () => {
  const A = token("X");
  const B = token("X");
  expect(A.id).not.toBe(B.id);
});

test("isToken distinguishes tokens from classes", () => {
  const T = token("T");
  class C {}
  expect(isToken(T)).toBe(true);
  expect(isToken(C)).toBe(false);
});
