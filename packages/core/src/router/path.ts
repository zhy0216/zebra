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
      if (p.length === 1) throw new Error(`path parameter name is missing in "${path}"`);
      const name = p.slice(1);
      assertValidName(name, "path parameter", path);
      result.push({ kind: "param", name });
    } else if (p.startsWith("*")) {
      if (p.length === 1) throw new Error(`wildcard name is missing in "${path}"`);
      if (i !== parts.length - 1) {
        throw new Error(`wildcard *${p.slice(1)} must be the last segment in "${path}"`);
      }
      const name = p.slice(1);
      assertValidName(name, "wildcard", path);
      result.push({ kind: "wildcard", name });
    } else {
      result.push({ kind: "static", value: p });
    }
  }
  return result;
}

function assertValidName(name: string, kind: string, path: string): void {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `${kind} "${name}" in "${path}" must contain only letters, digits and underscores`,
    );
  }
}
