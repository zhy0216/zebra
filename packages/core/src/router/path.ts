export type PathSegment =
  | { kind: "static"; value: string }
  | { kind: "param"; name: string }
  | { kind: "wildcard"; name: string };

export function parsePath(path: string): PathSegment[] {
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed === "") return [];
  const parts = trimmed.split("/");
  const result: PathSegment[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.startsWith(":")) {
      result.push({ kind: "param", name: p.slice(1) });
    } else if (p.startsWith("*")) {
      if (i !== parts.length - 1) {
        throw new Error(`wildcard *${p.slice(1)} must be the last segment in "${path}"`);
      }
      result.push({ kind: "wildcard", name: p.slice(1) });
    } else {
      result.push({ kind: "static", value: p });
    }
  }
  return result;
}
