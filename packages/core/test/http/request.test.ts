import { expect, test } from "bun:test";
import { buildRequest } from "../../src/http/request.ts";

test("buildRequest exposes params, query, headers, url", async () => {
  const raw = new Request("http://x/y?a=1&b=hi", {
    method: "GET",
    headers: { "x-foo": "bar" },
  });
  const z = buildRequest(raw, { id: "42" });
  expect(z.params).toEqual({ id: "42" });
  expect(z.query).toEqual({ a: "1", b: "hi" });
  expect(z.headers.get("x-foo")).toBe("bar");
  expect(z.url.pathname).toBe("/y");
  expect(z.raw).toBe(raw);
});

test("body is lazy: accessing returns parsed value", async () => {
  const raw = new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ k: 1 }),
  });
  const z = buildRequest(raw, {});
  expect(await z.body()).toEqual({ k: 1 });
});
