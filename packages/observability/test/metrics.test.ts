import { describe, expect, spyOn, test } from "bun:test";
import { type ZebraRequest, buildRequest } from "@zebra-web/core";
import { createTestApp } from "@zebra-web/testing";

import { type MetricsOptions, type MetricsSnapshot, metrics } from "../src/index.ts";

function makeReq(): ZebraRequest {
  return buildRequest(new Request("http://test.local/"), {});
}

const okNext = async (): Promise<Response> => new Response("ok", { status: 200 });

async function measureDurations(durations: number[], options: MetricsOptions = {}) {
  const m = metrics(options);
  let now = 0;
  const clock = spyOn(performance, "now").mockImplementation(() => now);
  try {
    for (const duration of durations) {
      await m(makeReq(), async () => {
        now += duration;
        return new Response("ok");
      });
    }
    return m.snapshot();
  } finally {
    clock.mockRestore();
  }
}

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
      5,
      10,
      25,
      50,
      100,
      250,
      500,
      1000,
      2500,
      5000,
      Number.POSITIVE_INFINITY,
    ]);
    expect(s.latency.buckets).toHaveLength(11);
    expect(s.latency.buckets.reduce((acc, n) => acc + n, 0)).toBe(7);
    expect(s.latencyP50).toBeGreaterThanOrEqual(0);
    expect(s.latencyP95).toBeGreaterThanOrEqual(0);
    expect(s.latencyP95).toBeGreaterThanOrEqual(s.latencyP50!);
  });

  test("nearest-rank P95 selects sample 11 from 1..11", async () => {
    const samples = Array.from({ length: 11 }, (_, index) => index + 1);
    const snapshot = await measureDurations(samples);
    expect(snapshot.latencySamples).toEqual(samples);
    expect(snapshot.latencyP50).toBe(6);
    expect(snapshot.latencyP95).toBe(11);
  });

  test("empty, single-value and unsorted samples use the same nearest-rank definition", async () => {
    const empty = metrics().snapshot();
    expect(empty.latencyP50).toBeUndefined();
    expect(empty.latencyP95).toBeUndefined();
    const single = await measureDurations([7]);
    expect(single.latencyP50).toBe(7);
    expect(single.latencyP95).toBe(7);
    const unsorted = await measureDurations([40, 10, 30, 20]);
    expect(unsorted.latencySamples).toEqual([40, 10, 30, 20]);
    expect(unsorted.latencyP50).toBe(20);
    expect(unsorted.latencyP95).toBe(40);
  });

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["negative", -1],
    ["negative fraction", -0.5],
    ["positive fraction", 1.5],
    ["null", null as unknown as number],
    ["string", "3" as unknown as number],
  ] as const)(
    "rejects invalid maxLatencySamples %s at construction",
    (_label, maxLatencySamples) => {
      expect(() => metrics({ maxLatencySamples })).toThrow(/maxLatencySamples/);
    },
  );

  test.each([0, 1, 3, 1000])(
    "1100 requests keep only the latest %i samples",
    async (maxLatencySamples) => {
      const durations = Array.from({ length: 1100 }, (_, index) => index + 1);
      const snapshot = await measureDurations(durations, { maxLatencySamples });
      expect(snapshot.totalRequests).toBe(1100);
      expect(snapshot.latency.buckets.reduce((sum, count) => sum + count, 0)).toBe(1100);
      expect(snapshot.latencySamples).toEqual(
        durations.slice(durations.length - maxLatencySamples),
      );
    },
  );

  test("the default capacity remains 1000 samples", async () => {
    const durations = Array.from({ length: 1100 }, (_, index) => index + 1);
    const snapshot = await measureDurations(durations);
    expect(snapshot.latencySamples).toEqual(durations.slice(100));
  });

  test("zero disables sample retention while preserving counters, histograms and callbacks", async () => {
    const observations: MetricsSnapshot[] = [];
    const snapshot = await measureDurations([7, 13], {
      maxLatencySamples: 0,
      onSample: (sample) => observations.push(sample),
    });
    expect(snapshot.latencySamples).toEqual([]);
    expect(snapshot.latencyP50).toBeUndefined();
    expect(snapshot.latencyP95).toBeUndefined();
    expect(snapshot.totalRequests).toBe(2);
    expect(snapshot.inFlight).toBe(0);
    expect(snapshot.errors).toBe(0);
    expect(snapshot.latency.buckets.reduce((sum, count) => sum + count, 0)).toBe(2);
    expect(observations).toHaveLength(2);
    expect(observations.map((sample) => sample.latencySamples)).toEqual([[], []]);
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
    s1.latencySamples[0] = 999;
    const s2 = m.snapshot();
    expect(s2.latency.buckets[0]).not.toBe(999);
    expect(s2.latencySamples[0]).not.toBe(999);
    expect(s2.latencyP50).toBe(s1.latencyP50);
    expect(s2.latencyP95).toBe(s1.latencyP95);
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
