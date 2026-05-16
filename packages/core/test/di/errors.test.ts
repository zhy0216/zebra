import { expect, test } from "bun:test";
import {
  CircularDependencyError,
  ScopeMismatchError,
  UnboundTokenError,
} from "../../src/di/errors.ts";

test("CircularDependencyError carries the path", () => {
  const e = new CircularDependencyError(["A", "B", "A"]);
  expect(e.message).toContain("A -> B -> A");
  expect(e.path).toEqual(["A", "B", "A"]);
});

test("UnboundTokenError names the identifier and resolution path", () => {
  const e = new UnboundTokenError("Db", ["BlogService", "BlogRepo", "Db"]);
  expect(e.message).toContain("Db");
  expect(e.message).toContain("BlogService -> BlogRepo -> Db");
});

test("ScopeMismatchError describes the violation", () => {
  const e = new ScopeMismatchError("Logger", "singleton", "Request", "request");
  expect(e.message).toContain("Logger");
  expect(e.message).toContain("singleton");
  expect(e.message).toContain("Request");
  expect(e.message).toContain("request");
});
