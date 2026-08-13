import { expect, test } from "bun:test";
import { Router } from "../../src/router/radix.ts";

test("static route match", () => {
  const r = new Router<string>();
  r.add("GET", "/hello", "h");
  expect(r.find("GET", "/hello")).toEqual({ handler: "h", params: {} });
});

test("param route extracts variables", () => {
  const r = new Router<string>();
  r.add("GET", "/blogs/:id", "show");
  const m = r.find("GET", "/blogs/42");
  expect(m).toEqual({ handler: "show", params: { id: "42" } });
});

test("multiple params", () => {
  const r = new Router<string>();
  r.add("GET", "/blogs/:id/comments/:cid", "h");
  expect(r.find("GET", "/blogs/1/comments/2")).toEqual({
    handler: "h",
    params: { id: "1", cid: "2" },
  });
});

test("static beats param when both match", () => {
  const r = new Router<string>();
  r.add("GET", "/blogs/:id", "any");
  r.add("GET", "/blogs/new", "new");
  expect(r.find("GET", "/blogs/new")?.handler).toBe("new");
  expect(r.find("GET", "/blogs/42")?.handler).toBe("any");
});

test("method mismatch returns null", () => {
  const r = new Router<string>();
  r.add("GET", "/x", "g");
  expect(r.find("POST", "/x")).toBeNull();
});

test("wildcard captures rest", () => {
  const r = new Router<string>();
  r.add("GET", "/files/*path", "h");
  expect(r.find("GET", "/files/a/b/c.txt")).toEqual({
    handler: "h",
    params: { path: "a/b/c.txt" },
  });
});

test("unknown route returns null", () => {
  const r = new Router<string>();
  r.add("GET", "/a", "h");
  expect(r.find("GET", "/b")).toBeNull();
});

test("parameter names belong to each method's registered route", () => {
  const r = new Router<string>();
  r.add("GET", "/users/:id", "get");
  r.add("POST", "/users/:userId", "post");
  expect(r.find("GET", "/users/1")?.params).toEqual({ id: "1" });
  expect(r.find("POST", "/users/2")?.params).toEqual({ userId: "2" });
});

test("param values are percent-decoded", () => {
  const r = new Router<string>();
  r.add("GET", "/users/:id", "h");
  expect(r.find("GET", "/users/foo%20bar")?.params).toEqual({ id: "foo bar" });
  // Encoded separators decode into the value only; matching happens on the
  // raw segment, so %2F never reaches the router as a path split.
  expect(r.find("GET", "/users/a%2Fb")?.params).toEqual({ id: "a/b" });
});

test("malformed percent-encoding keeps the raw value", () => {
  const r = new Router<string>();
  r.add("GET", "/users/:id", "h");
  expect(r.find("GET", "/users/%zz")?.params).toEqual({ id: "%zz" });
});

test("wildcard captures are not percent-decoded", () => {
  const r = new Router<string>();
  r.add("GET", "/files/*path", "h");
  expect(r.find("GET", "/files/a%2Fb/c%20d")?.params).toEqual({ path: "a%2Fb/c%20d" });
});

test("duplicate registration with the same parameter layout throws", () => {
  const r = new Router<string>();
  r.add("GET", "/a/:id", "one");
  expect(() => r.add("GET", "/a/:slug", "two")).toThrow(/Duplicate route/);
});

test("a param segment wins over a wildcard for a single-segment path", () => {
  const r = new Router<string>();
  r.add("GET", "/x/:id", "param");
  r.add("GET", "/x/*rest", "wildcard");
  expect(r.find("GET", "/x/42")?.handler).toBe("param");
  // Deeper paths can only match the wildcard.
  expect(r.find("GET", "/x/a/b")?.handler).toBe("wildcard");
  expect(r.find("GET", "/x/a/b")?.params).toEqual({ rest: "a/b" });
});

test("trailing slashes are ignored by the matcher", () => {
  const r = new Router<string>();
  r.add("GET", "/a", "h");
  expect(r.find("GET", "/a/")?.handler).toBe("h");
  expect(r.find("GET", "///a///")?.handler).toBe("h");
});
