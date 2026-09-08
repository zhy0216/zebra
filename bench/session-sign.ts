import { createHmac, timingSafeEqual } from "node:crypto";
import { cpus } from "node:os";

import { sign, verify } from "../packages/session/src/sign.ts";

// Compare the previous implementation with the exported session helpers.
// These are synchronous phase costs, not HTTP throughput measurements.
const ITERATIONS = 100_000;
const WARMUP = 20_000;
const ROUNDS = 7;
const SECRET = "session-benchmark-secret-0123456789abcdef";
const encoder = new TextEncoder();

function legacyHmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function legacySign(value: string, secret: string): string {
  if (!secret) throw new Error("sign: secret is required");
  return `${value}.${legacyHmac(value, secret)}`;
}

function legacyVerify(value: string, secret: string): string | null {
  if (!secret) throw new Error("sign: secret is required");
  const lastDot = value.lastIndexOf(".");
  if (lastDot === -1) return null;
  const sid = value.slice(0, lastDot);
  const sig = value.slice(lastDot + 1);
  if (!sid || !sig) return null;
  const a = encoder.encode(legacyHmac(sid, secret));
  const b = encoder.encode(sig);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? sid : null;
}

// Vary UUID-sized inputs while keeping generation outside the timed loops.
const ids = Array.from(
  { length: 256 },
  (_, i) => `8f3a1c9e-2b4d-4a0f-9c6e-${i.toString(16).padStart(12, "0")}`,
);
const tokens = ids.map((id) => legacySign(id, SECRET));
for (let i = 0; i < ids.length; i++) {
  if (sign(ids[i]!, SECRET) !== tokens[i] || verify(tokens[i]!, SECRET) !== ids[i]) {
    throw new Error("Session signature compatibility check failed");
  }
}

let checksum = 0;
type Operation = (i: number) => string | null;

function measure(operation: Operation, count: number): number {
  let consumed = 0;
  const start = performance.now();
  for (let i = 0; i < count; i++) consumed += operation(i)?.length ?? 0;
  const elapsed = performance.now() - start;
  checksum += consumed;
  return (elapsed * 1_000_000) / count;
}

function median(samples: number[]): number {
  return [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
}

const phases: { name: string; legacy: Operation; native: Operation }[] = [
  {
    name: "sign",
    legacy: (i) => legacySign(ids[i & 255]!, SECRET),
    native: (i) => sign(ids[i & 255]!, SECRET),
  },
  {
    name: "verify valid cookie",
    legacy: (i) => legacyVerify(tokens[i & 255]!, SECRET),
    native: (i) => verify(tokens[i & 255]!, SECRET),
  },
];

console.log(`Bun ${Bun.version} | ${process.platform} ${process.arch} | ${cpus()[0]?.model}`);
console.log(`${ROUNDS} rounds × ${ITERATIONS} operations; ${WARMUP} warmup per implementation`);
console.log("Median ns/op, including helper work; lower is better. Order alternates each round.");
for (const phase of phases) {
  measure(phase.legacy, WARMUP);
  measure(phase.native, WARMUP);
  const samples = { legacy: [] as number[], native: [] as number[] };
  for (let round = 0; round < ROUNDS; round++) {
    const order: ("legacy" | "native")[] =
      round % 2 === 0 ? ["legacy", "native"] : ["native", "legacy"];
    for (const implementation of order) {
      samples[implementation].push(measure(phase[implementation], ITERATIONS));
    }
  }
  const legacy = median(samples.legacy);
  const native = median(samples.native);
  console.log(
    `${phase.name}: node:crypto ${legacy.toFixed(1)} | Bun.CryptoHasher ${native.toFixed(1)} | ${(legacy / native).toFixed(2)}× | ${((1 - native / legacy) * 100).toFixed(1)}% less time`,
  );
}
console.log(`checksum: ${checksum}`);
