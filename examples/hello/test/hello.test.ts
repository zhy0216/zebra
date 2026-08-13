import { expect, test } from "bun:test";

import { buildHelloApp } from "../src/app.ts";

test("hello example answers with the route param", async () => {
  const app = buildHelloApp();
  const res = await app.dispatch(new Request("http://test.local/hello/zebra"));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hello, zebra");
});
