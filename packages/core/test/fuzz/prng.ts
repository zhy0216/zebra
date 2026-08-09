/**
 * Deterministic helpers for property/fuzz tests. Every test uses a fixed seed
 * (mulberry32) so failures reproduce exactly; the seed is included in
 * assertion messages.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function int(rnd: () => number, min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1));
}

export function pick<T>(rnd: () => number, items: readonly T[]): T {
  return items[Math.floor(rnd() * items.length)]!;
}

const ASCII = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SPECIAL = "-_.~%!*'()@+&$#,;:[]{}|^`<>?/\\\" ";

/** Random string of random length over a mixed alphabet (ASCII + unicode + controls). */
export function randomString(rnd: () => number, maxLen: number): string {
  const length = int(rnd, 0, maxLen);
  let out = "";
  for (let i = 0; i < length; i++) {
    switch (int(rnd, 0, 9)) {
      case 0:
      case 1:
        out += pick(rnd, [...ASCII]);
        break;
      case 2:
        out += pick(rnd, [...SPECIAL]);
        break;
      case 3:
        out += pick(rnd, ["é", "中", "日", "🙂", "ß", "ö"]);
        break;
      default:
        out += pick(rnd, [...ASCII]);
        break;
    }
  }
  return out;
}
