import { parsePath } from "./path.ts";

interface Node<T> {
  static: Map<string, Node<T>>;
  param?: Node<T>;
  wildcard?: Node<T>;
  handlers: Map<string, { handler: T; paramNames: string[] }>;
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
    node.handlers.set(method.toUpperCase(), { handler, paramNames });
  }

  find(method: string, path: string): MatchResult<T> | null {
    const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
    const parts = trimmed === "" ? [] : trimmed.split("/");
    return this.walk(this.root, parts, 0, [], method.toUpperCase());
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
      return entry !== undefined ? this.toMatch(entry, captures) : null;
    }
    const part = parts[idx]!;
    const staticChild = node.static.get(part);
    if (staticChild) {
      const r = this.walk(staticChild, parts, idx + 1, captures, method);
      if (r) return r;
    }
    if (node.param) {
      const r = this.walk(node.param, parts, idx + 1, [...captures, part], method);
      if (r) return r;
    }
    if (node.wildcard) {
      const rest = parts.slice(idx).join("/");
      const entry = node.wildcard.handlers.get(method);
      if (entry !== undefined) {
        return this.toMatch(entry, [...captures, rest]);
      }
    }
    return null;
  }

  private toMatch(entry: { handler: T; paramNames: string[] }, captures: string[]): MatchResult<T> {
    const params: Record<string, string> = {};
    for (let i = 0; i < entry.paramNames.length; i++) {
      params[entry.paramNames[i]!] = captures[i]!;
    }
    return { handler: entry.handler, params };
  }
}
