import { parsePath } from "./path.ts";

interface Node<T> {
  static: Map<string, Node<T>>;
  param?: Node<T>;
  wildcard?: Node<T>;
  handlers: Map<string, { handler: T; paramNames: string[]; wildcardName?: string }>;
}

function newNode<T>(): Node<T> {
  return { static: new Map(), handlers: new Map() };
}

export interface MatchResult<T> {
  handler: T;
  params: Record<string, string>;
}

export class Router<T> {
  private root: Node<T> = newNode();

  add(method: string, path: string, handler: T): void {
    const segs = parsePath(path);
    const upperMethod = method.toUpperCase();
    let node = this.root;
    const paramNames: string[] = [];
    for (const s of segs) {
      if (s.kind === "static") {
        let next = node.static.get(s.value);
        if (!next) {
          next = newNode();
          node.static.set(s.value, next);
        }
        node = next;
      } else if (s.kind === "param") {
        node.param ??= newNode();
        node = node.param;
        paramNames.push(s.name);
      } else {
        node.wildcard ??= newNode();
        node = node.wildcard;
        paramNames.push(s.name);
        break;
      }
    }
    if (node.handlers.has(upperMethod)) {
      throw new Error(
        `Duplicate route: ${upperMethod} ${path} is already registered (with the same parameter layout)`,
      );
    }
    const entry: { handler: T; paramNames: string[]; wildcardName?: string } = {
      handler,
      paramNames,
    };
    const lastSeg = segs.at(-1);
    if (lastSeg?.kind === "wildcard") entry.wildcardName = lastSeg.name;
    node.handlers.set(upperMethod, entry);
  }

  find(method: string, path: string): MatchResult<T> | null {
    return this.walk(this.root, splitPath(path), 0, [], method.toUpperCase());
  }

  /** Methods that would match this path if the method differed, or null when the path itself is unknown. */
  allowedMethods(path: string): string[] | null {
    return this.collectMethods(this.root, splitPath(path), 0);
  }

  private collectMethods(node: Node<T>, parts: string[], idx: number): string[] | null {
    if (idx === parts.length) {
      if (node.handlers.size > 0) return [...node.handlers.keys()];
      const wildcard = node.wildcard;
      if (wildcard && wildcard.handlers.size > 0) return [...wildcard.handlers.keys()];
      return null;
    }
    const part = parts[idx]!;
    const staticChild = node.static.get(part);
    if (staticChild) {
      const r = this.collectMethods(staticChild, parts, idx + 1);
      if (r !== null) return r;
    }
    if (node.param) {
      const r = this.collectMethods(node.param, parts, idx + 1);
      if (r !== null) return r;
    }
    const wildcard = node.wildcard;
    if (wildcard && wildcard.handlers.size > 0) return [...wildcard.handlers.keys()];
    return null;
  }

  private walk(
    node: Node<T>,
    parts: string[],
    idx: number,
    captures: string[],
    method: string,
  ): MatchResult<T> | null {
    if (idx === parts.length) {
      const entry = node.handlers.get(method);
      if (entry !== undefined) return this.toMatch(entry, captures);
      const wildcard = node.wildcard;
      if (wildcard) {
        const wEntry = wildcard.handlers.get(method);
        if (wEntry !== undefined) {
          captures.push("");
          const match = this.toMatch(wEntry, captures);
          captures.pop();
          return match;
        }
      }
      return null;
    }
    const part = parts[idx]!;
    const staticChild = node.static.get(part);
    if (staticChild) {
      const r = this.walk(staticChild, parts, idx + 1, captures, method);
      if (r) return r;
    }
    if (node.param) {
      // push/pop instead of a per-branch copy: one captures array per lookup,
      // backtracks cleanly when the param branch fails and the wildcard tries.
      captures.push(part);
      const r = this.walk(node.param, parts, idx + 1, captures, method);
      captures.pop();
      if (r) return r;
    }
    if (node.wildcard) {
      const rest = parts.slice(idx).join("/");
      const entry = node.wildcard.handlers.get(method);
      if (entry !== undefined) {
        captures.push(rest);
        const match = this.toMatch(entry, captures);
        captures.pop();
        return match;
      }
    }
    return null;
  }

  private toMatch(
    entry: { handler: T; paramNames: string[]; wildcardName?: string },
    captures: string[],
  ): MatchResult<T> {
    const params: Record<string, string> = Object.create(null);
    for (let i = 0; i < entry.paramNames.length; i++) {
      const name = entry.paramNames[i]!;
      // Matching happens on the raw (still-encoded) pathname segments, so an
      // encoded separator like %2F can never shadow a static route; only the
      // captured value is decoded. Wildcard captures keep their raw form:
      // they carry path separators whose encoding state is ambiguous.
      params[name] = name === entry.wildcardName ? captures[i]! : decodeParam(captures[i]!);
    }
    return { handler: entry.handler, params };
  }
}

/** Decodes one param capture; malformed encodings are kept verbatim. */
function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitPath(path: string): string[] {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? [] : trimmed.split("/");
}
