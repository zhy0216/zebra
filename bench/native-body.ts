import assert from "node:assert/strict";
import { cpus, release } from "node:os";
import { readBody } from "../packages/core/src/http/body.ts";
import { HttpError } from "../packages/core/src/http/errors.ts";

// Run only in an exclusive measurement slot. --check asserts behavior without timing.
// Frozen before path: 1418a2f (also unchanged in the session baseline 4466df7).
// Keep both readers inline: a shared merge callback would add artificial dispatch cost.
// The candidate differs only in the final merge, after every byte has passed the limit.

function assertDeclaredSize(req: Request, limit: number): void {
  const value = req.headers.get("content-length");
  if (value === null) return;
  if (value === "" || /[^0-9]/.test(value)) {
    throw new HttpError(400, "invalid_content_length", "Invalid Content-Length header");
  }
  const length = Number(value);
  // Reject obvious overflow first; compare large integers exactly so rounding
  // cannot hide a declaration just above the limit.
  if (length > limit || (!Number.isSafeInteger(length) && BigInt(value) > limit)) {
    throw new HttpError(413, "payload_too_large", "Payload too large", { limit });
  }
}

async function legacyReadBody(
  req: Request,
  limit: number,
  // Called only after acquiring the reader, so consumers can distinguish
  // stream failures from conflicting readers without changing raw errors.
  onReadError?: (error: unknown) => void,
): Promise<Uint8Array> {
  assertDeclaredSize(req, limit);
  if (req.bodyUsed) throw new TypeError("Request body has already been consumed");
  if (!req.body) return new Uint8Array();

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        // Cancellation must neither replace the 413 nor delay it indefinitely.
        void reader.cancel().catch(() => {});
        throw new HttpError(413, "payload_too_large", "Payload too large", { limit });
      }
      chunks.push(value);
    }
  } catch (error) {
    onReadError?.(error);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function nativeReadBody(
  req: Request,
  limit: number,
  // Called only after acquiring the reader, so consumers can distinguish
  // stream failures from conflicting readers without changing raw errors.
  onReadError?: (error: unknown) => void,
): Promise<Uint8Array> {
  assertDeclaredSize(req, limit);
  if (req.bodyUsed) throw new TypeError("Request body has already been consumed");
  if (!req.body) return new Uint8Array();

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        // Cancellation must neither replace the 413 nor delay it indefinitely.
        void reader.cancel().catch(() => {});
        throw new HttpError(413, "payload_too_large", "Payload too large", { limit });
      }
      chunks.push(value);
    }
  } catch (error) {
    onReadError?.(error);
    throw error;
  } finally {
    reader.releaseLock();
  }

  return Bun.concatArrayBuffers(chunks, size, true);
}

type Merge = (chunks: Uint8Array[], size: number) => Uint8Array;
type Reader = typeof readBody;
type Implementation = "legacy" | "native";
type Phase = "merge" | "readBody";

function legacyMerge(chunks: Uint8Array[], size: number): Uint8Array {
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function nativeMerge(chunks: Uint8Array[], size: number): Uint8Array {
  return Bun.concatArrayBuffers(chunks, size, true);
}

interface Scenario {
  name: string;
  chunks: Uint8Array[];
  expected: Uint8Array;
  contentType: string;
  declared: string | null;
}

function scenario(
  name: string,
  chunks: Uint8Array[],
  contentType = "application/octet-stream",
  declared: "exact" | "understated" | null = null,
): Scenario {
  // Independent byte-by-byte oracle; do not use either measured merge as the oracle.
  const expected = Uint8Array.from(chunks.flatMap((chunk) => Array.from(chunk)));
  return {
    name,
    chunks,
    expected,
    contentType,
    declared:
      declared === "exact" ? String(expected.length) : declared === "understated" ? "0" : null,
  };
}

function patternedChunks(count: number, size: number, view?: "uint8" | "buffer"): Uint8Array[] {
  return Array.from({ length: count }, (_, chunkIndex) => {
    const offset = view === undefined ? 0 : 13;
    const backing = new Uint8Array(size + offset * 2).fill(231);
    const chunk =
      view === "buffer"
        ? Buffer.from(backing.buffer, offset, size)
        : backing.subarray(offset, offset + size);
    for (let i = 0; i < size; i++) chunk[i] = (chunkIndex * 17 + i * 31) & 255;
    return chunk;
  });
}

const json = new TextEncoder().encode(
  JSON.stringify({ id: 42, name: "你好 Zebra 🦓", active: true, tags: ["bun", "http"] }),
);
// Fixed before measuring; all scenarios (including slower ones) always run.
const scenarios = [
  scenario("empty-stream", [], "application/octet-stream", "exact"),
  scenario("empty-chunks", [new Uint8Array(), new Uint8Array()]),
  scenario("single-byte", [new Uint8Array([255])]),
  scenario("small-json-single", [json], "application/json", "exact"),
  scenario(
    "small-json-chunked",
    [json.subarray(0, 19), new Uint8Array(), json.subarray(19)],
    "application/json",
  ),
  scenario("16x1KiB", patternedChunks(16, 1024)),
  scenario("256x64B", patternedChunks(256, 64)),
  scenario(
    "offset-uint8-16x1KiB",
    patternedChunks(16, 1024, "uint8"),
    "application/octet-stream",
    "understated",
  ),
  scenario("offset-buffer-16x1KiB", patternedChunks(16, 1024, "buffer")),
  scenario(
    "large-single-1MiB",
    patternedChunks(1, 1024 * 1024),
    "application/octet-stream",
    "exact",
  ),
  scenario("large-64x16KiB", patternedChunks(64, 16 * 1024)),
];

function requestFor(input: Scenario): Request {
  let index = 0;
  return new Request("http://body.bench/upload", {
    method: "POST",
    headers: {
      "content-type": input.contentType,
      ...(input.declared === null ? {} : { "content-length": input.declared }),
    },
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < input.chunks.length) controller.enqueue(input.chunks[index++]!);
        else controller.close();
      },
    }),
  });
}

const mergers: Record<Implementation, Merge> = { legacy: legacyMerge, native: nativeMerge };
const readers: Record<Implementation, Reader> = { legacy: legacyReadBody, native: nativeReadBody };

async function checkCorrectness(): Promise<void> {
  for (const input of scenarios) {
    const backings = [...new Set(input.chunks.map((chunk) => chunk.buffer))];
    const snapshots = backings.map((buffer) => new Uint8Array(buffer).slice());
    const outputs: Uint8Array[] = [];
    for (const merge of Object.values(mergers))
      outputs.push(merge(input.chunks, input.expected.length));
    for (const read of [...Object.values(readers), readBody]) {
      const request = requestFor(input);
      outputs.push(await read(request, input.expected.length));
      assert.equal(request.body!.locked, false);
      if (input.expected.length > 0) {
        const tooSmall = requestFor({ ...input, declared: null });
        await assert.rejects(read(tooSmall, input.expected.length - 1), {
          status: 413,
          code: "payload_too_large",
        });
        assert.equal(tooSmall.body!.locked, false);
      }
    }
    for (const output of outputs) {
      assert(output instanceof Uint8Array);
      assert.deepEqual(output, input.expected, input.name);
      assert.equal(output.byteOffset, 0);
      assert.equal(output.buffer.byteLength, input.expected.length);
      for (const backing of backings) assert.notEqual(output.buffer, backing);
    }
    backings.forEach((buffer, i) => assert.deepEqual(new Uint8Array(buffer), snapshots[i]));
    for (const chunk of input.chunks) chunk.fill(42);
    for (const output of outputs) assert.deepEqual(output, input.expected);
    backings.forEach((buffer, i) => new Uint8Array(buffer).set(snapshots[i]!));
    for (const output of outputs) output.fill(99);
    backings.forEach((buffer, i) => assert.deepEqual(new Uint8Array(buffer), snapshots[i]));
  }
  for (const read of [...Object.values(readers), readBody]) {
    const input = scenarios[2]!;
    const declared = requestFor({ ...input, declared: "2" });
    let callbacks = 0;
    const onReadError = () => {
      callbacks++;
    };
    await assert.rejects(read(declared, 1, onReadError), { status: 413 });
    assert.equal(declared.bodyUsed, false);
    const locked = requestFor(input);
    const reader = locked.body!.getReader();
    try {
      await assert.rejects(read(locked, 1, onReadError), TypeError);
    } finally {
      reader.releaseLock();
      await locked.body!.cancel();
    }
    const used = requestFor(input);
    await used.arrayBuffer();
    await assert.rejects(read(used, 1, onReadError), TypeError);
    assert.equal(callbacks, 0);
  }
  console.log(
    JSON.stringify({
      type: "correctness",
      bun: Bun.version,
      scenarios: scenarios.length,
      status: "passed",
    }),
  );
}

function positiveInteger(name: string, fallback: number, minimum = 1): number {
  const value = Number(process.env[name] ?? fallback);
  assert(
    Number.isSafeInteger(value) && value >= minimum,
    `${name} must be an integer >= ${minimum}`,
  );
  return value;
}

function consume(bytes: Uint8Array, index: number): number {
  return (
    bytes.length +
    (bytes[0] ?? 0) +
    (bytes[bytes.length >>> 1] ?? 0) +
    (bytes.at(-1) ?? 0) +
    (index & 255)
  );
}

interface Sample {
  nsPerOp: number;
  checksum: number;
}

function measureMerge(merge: Merge, input: Scenario, count: number): Sample {
  let checksum = 0;
  const start = performance.now();
  for (let i = 0; i < count; i++)
    checksum += consume(merge(input.chunks, input.expected.length), i);
  return { nsPerOp: ((performance.now() - start) * 1e6) / count, checksum };
}

async function measureRead(read: Reader, input: Scenario, count: number): Promise<Sample> {
  let checksum = 0;
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    checksum += consume(await read(requestFor(input), input.expected.length), i);
  }
  return { nsPerOp: ((performance.now() - start) * 1e6) / count, checksum };
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

assert(
  process.argv.slice(2).every((arg) => arg === "--check"),
  "Only --check is supported",
);
await checkCorrectness();
if (!process.argv.includes("--check")) {
  const rounds = positiveInteger("NATIVE_BODY_ROUNDS", 9, 7);
  const scale = positiveInteger("NATIVE_BODY_SCALE", 1);
  console.log(
    JSON.stringify({
      type: "environment",
      bun: Bun.version,
      revision: Bun.revision,
      platform: process.platform,
      arch: process.arch,
      kernel: release(),
      cpu: cpus()[0]?.model,
      cpuCount: cpus().length,
      baseline: "1418a2f",
      rounds,
      scale,
      candidate: "Bun.concatArrayBuffers(chunks, size, true)",
      units: "ns/op; lower is better; phase costs, not HTTP throughput",
      costs:
        "Both allocate and copy output. Input bytes excluded for both. Full read includes Request/Headers/stream creation, identical declared/streamed limits, reader handling and consumption; no JSON parsing.",
      gc: "Bun.gc(true) before every warmup/sample, outside timing; automatic GC inside timing included",
      order: "Alternates every round; opposite starting order in adjacent scenarios",
    }),
  );
  let checksum = 0;
  for (const phase of ["merge", "readBody"] as const satisfies Phase[]) {
    for (const [scenarioIndex, input] of scenarios.entries()) {
      const size = input.expected.length;
      const iterations =
        scale *
        (phase === "merge"
          ? Math.max(128, Math.min(100_000, Math.floor((32 * 1024 * 1024) / Math.max(size, 1))))
          : Math.max(64, Math.min(5_000, Math.floor((16 * 1024 * 1024) / Math.max(size, 1)))));
      const warmup = Math.max(16, Math.floor(iterations / 4));
      const run = (implementation: Implementation, count: number) =>
        phase === "merge"
          ? measureMerge(mergers[implementation], input, count)
          : measureRead(readers[implementation], input, count);
      console.log(
        JSON.stringify({
          type: "scenario",
          phase,
          name: input.name,
          bytes: size,
          chunkLengths: input.chunks.map((chunk) => chunk.byteLength),
          chunkOffsets: input.chunks.map((chunk) => chunk.byteOffset),
          declared: input.declared,
          limit: size,
          iterations,
          warmup,
          warmupBatches: 2,
        }),
      );
      for (const implementation of ["legacy", "native", "native", "legacy"] as const) {
        Bun.gc(true);
        checksum += (await run(implementation, warmup)).checksum;
      }
      const samples: Record<Implementation, number[]> = { legacy: [], native: [] };
      for (let round = 0; round < rounds; round++) {
        const order: Implementation[] =
          (round + scenarioIndex) % 2 === 0 ? ["legacy", "native"] : ["native", "legacy"];
        let expectedChecksum: number | undefined;
        for (const implementation of order) {
          Bun.gc(true);
          const sample = await run(implementation, iterations);
          if (expectedChecksum !== undefined) assert.equal(sample.checksum, expectedChecksum);
          expectedChecksum = sample.checksum;
          checksum += sample.checksum;
          samples[implementation].push(sample.nsPerOp);
          console.log(
            JSON.stringify({
              type: "sample",
              phase,
              name: input.name,
              round: round + 1,
              order,
              implementation,
              ...sample,
            }),
          );
        }
      }
      const legacy = median(samples.legacy);
      const native = median(samples.native);
      console.log(
        JSON.stringify({
          type: "summary",
          phase,
          name: input.name,
          samples,
          median: { legacy, native },
          nativeTimeChangePercent: (native / legacy - 1) * 100,
          pairedTimeChangePercent: samples.native.map(
            (value, i) => (value / samples.legacy[i]! - 1) * 100,
          ),
        }),
      );
    }
  }
  console.log(JSON.stringify({ type: "consumption", checksum }));
}
