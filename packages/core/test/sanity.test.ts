import { expect, test } from "bun:test";
import { VERSION } from "../src/index.ts";

test("package loads", () => {
  expect(typeof VERSION).toBe("string");
});
