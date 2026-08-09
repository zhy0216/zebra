import { describe, expect, test } from "bun:test";
import { buildRequest, type ZebraRequest } from "@zebra/core";
import { createTestApp } from "@zebra/testing";

import { metrics, type MetricsSnapshot } from "../src/index.ts";

function makeReq(): ZebraRequest {
  return buildRequest(new Request("http://test.local/"), {});
}

const okNext = async (): Promise<Response> => new Response("ok", { status: 200 });

describe("metrics middleware", () => {
  test("counts requests and thrown errors", async () => {
    const m = metrics();
    await m(makeReq(), okNext);
    await m(makeReq(), okNext);
    await expect(m(makeReq(), async () => Promise.reject(new Error("boom")))).rejects.toThrow();
    const s = m.snapshot();
    expect(s.totalRequests).toBe(3);
    expect(s.errors).toBe(1);
    expect(s.inFlight).toBe(0);
    expect(s.peakInFlight).toBe(1);
  });

  test("counts 5xx responses as errors", async () => {
    const m = metrics();
    await m(makeReq(), async () => new Response("nope", { status: 500 }));
    await m(makeReq(), async () => new Response("bad", { status: 503 }));
    await m(makeReq(), okNext);
    expect(m.snapshot().errors).toBe(2);
  });

  test("tracks in-flight with the peak while requests are pending", async () => {
    const m = metrics();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = m(makeReq(), async () => {
      await gate;
      return new Response("ok");
    });
    expect(m.snapshot().inFlight).toBe(1);
    expect(m.snapshot().peakInFlight).toBe(1);
    release!();
    await pending;
    const s = m.snapshot();
    expect(s.inFlight).toBe(0);
    expect(s.peakInFlight).toBe(1);
    expect(s.totalRequests).toBe(1);
  });

  test("records latency into histogram buckets and percentiles", async () => {
    const m = metrics();
    for (let i = 0; i < 7; i++) await m(makeReq(), okNext);
    const s = m.snapshot();
    expect(s.latency.bucketBoundsMs).toEqual([
      5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, Infinity,
    ]);
    expect(s.latency.buckets).toHaveLength(11);
    expect(s.latency.buckets.reduce((acc, n) => acc + n, 0)).toBe(7);
    expect(s.latencyP50).toBeGreaterThanOrEqual(0);
    expect(s.latencyP95).toBeGreaterThanOrEqual(0);
    expect(s.latencyP95).toBeGreaterThanOrEqual(s.latencyP50!);
  });

  test("keeps the latency sample window bounded", async () => {
    const m = metrics({ maxLatencySamples: 3 });
    for (let i = 0; i < 10; i++) await m(makeReq(), okNext);
    const s = m.snapshot();
    expect(s.totalRequests).toBe(10);
    expect(s.latencySamples).toHaveLength(3);
    expect(s.latencyP50).toBeDefined();
  });

  test("calls onSample once per completed request with the snapshot", async () => {
    const samples: MetricsSnapshot[] = [];
    const m = metrics({ onSample: (s) => samples.push(s) });
    await m(makeReq(), okNext);
    await m(makeReq(), okNext);
    expect(samples).toHaveLength(2);
    expect(samples[0]!.totalRequests).toBe(1);
    expect(samples[1]!.totalRequests).toBe(2);
    expect(samples[1]!.errors).toBe(0);
  });

  test("snapshot copies are independent", async () => {
    const m = metrics();
    await m(makeReq(), okNext);
    const s1 = m.snapshot();
    s1.latency.buckets[0] = 999;
    const s2 = m.snapshot();
    expect(s2.latency.buckets[0]).not.toBe(999);
  });
});

describe("metrics middleware · integration through core", () => {
  test("counts requests through a real app", async () => {
    const m = metrics();
    const app = createTestApp();
    app.use(m);
    app.get("/", () => Response.json({ ok: true }));
    await app.request("/");
    await app.request("/");
    const s = m.snapshot();
    expect(s.totalRequests).toBe(2);
    expect(s.errors).toBe(0);
  });

  test("handler throws are counted as errors", async () => {
    const m = metrics();
    const app = createTestApp();
    app.use(m);
    app.get("/boom", () => {
      throw new Error("boom");
    });
    await app.request("/boom");
    const s = m.snapshot();
    expect(s.totalRequests).toBe(1);
    expect(s.errors).toBe(1);
  });
});
