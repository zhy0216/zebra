import { expect, test } from "bun:test";
import { createClient } from "@zebra/client";

import { buildContractBlogApp } from "../src/app.ts";
import { blogContract } from "../src/contract.ts";

test("contract-blog round-trip through the typed client", async () => {
  const app = buildContractBlogApp();
  // The typed client drives the same contract the server implements — the
  // fetch is in-process dispatch, no sockets.
  const api = createClient(blogContract, {
    baseUrl: "http://test.local",
    fetch: (input, init) =>
      app.dispatch(new Request(typeof input === "string" ? input : input.url, init)),
  });

  const created = await api.create({ body: { title: "t", content: "c" } });
  expect(created).toEqual({ id: 1, title: "t", content: "c" });

  expect(await api.list()).toEqual([{ id: 1, title: "t", content: "c" }]);
  expect(await api.get({ params: { id: "1" } })).toEqual({ id: 1, title: "t", content: "c" });

  await api.remove({ params: { id: "1" } });
  expect(await api.list()).toEqual([]);
});
