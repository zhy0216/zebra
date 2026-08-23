import { expect, test } from "bun:test";
import { createClient } from "@zebra-web/client";

import { buildContractBlogApp } from "../src/app.ts";
import { blogContract } from "../src/contract.ts";

test("contract-blog round-trip through the typed client", async () => {
  const app = buildContractBlogApp();
  // The typed client drives the same contract the server implements — the
  // fetch is in-process dispatch, no sockets.
  const api = createClient(blogContract, {
    baseUrl: "http://test.local",
    // createClient's fetch option receives the final string URL, not a
    // RequestInfo/URL (narrowed by the native compiler).
    fetch: (url, init) => app.dispatch(new Request(url, init)),
  });

  const created = await api.create({ body: { title: "t", content: "c" } });
  expect(created).toEqual({ id: 1, title: "t", content: "c" });

  // `list` declares a query schema (page has a default), so the client
  // requires an explicit query object — pass an empty one to use the default.
  expect(await api.list({ query: {} })).toEqual([{ id: 1, title: "t", content: "c" }]);
  // Params are declared with z.coerce.number().int(), whose input type is
  // `number`; pass numeric ids (the server coerces the path segment).
  expect(await api.get({ params: { id: 1 } })).toEqual({ id: 1, title: "t", content: "c" });

  await api.remove({ params: { id: 1 } });
  expect(await api.list({ query: {} })).toEqual([]);
});
