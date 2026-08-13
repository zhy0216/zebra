import { expect, test } from "bun:test";
import * as core from "@zebra/core";
import * as cors from "@zebra/cors";
import * as rateLimit from "@zebra/rate-limit";
import * as session from "@zebra/session";

import * as facade from "../src/index.ts";

test("facade re-exports the full core, cors and session surfaces", () => {
  for (const key of Object.keys(core)) {
    expect(key in facade, `missing core export ${key}`).toBe(true);
  }
  for (const key of Object.keys(cors)) {
    expect(key in facade, `missing cors export ${key}`).toBe(true);
  }
  for (const key of Object.keys(session)) {
    expect(key in facade, `missing session export ${key}`).toBe(true);
  }
});

test("rate-limit exports are present with the documented aliases", () => {
  expect(facade.rateLimit).toBe(rateLimit.rateLimit);
  expect(facade.createLimiter).toBe(rateLimit.createLimiter);
  expect(facade.checkLimit).toBe(rateLimit.checkLimit);
  // MemoryStore collides with session's re-export and is aliased (frozen,
  // documented in docs/api-freeze.md §3 "zebra").
  expect(facade.RateLimitMemoryStore).toBe(rateLimit.MemoryStore);
  expect(facade.RateLimitMemoryStoreOptions).toBe(rateLimit.MemoryStoreOptions);
  expect(facade.MemoryStore).toBe(session.MemoryStore);
});

test("contract / client / testing / observability / redis are not re-exported", () => {
  // Kept out of the facade on purpose (tree-shakeable facade, see the freeze
  // doc); import them from their own packages.
  for (const key of ["zc", "createClient", "createTestApp", "requestId", "RedisRateLimitStore"]) {
    expect(key in facade).toBe(false);
  }
});
