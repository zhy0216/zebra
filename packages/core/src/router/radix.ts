import { parsePath } from "./path.ts";

interface Node<T> {
  static: Map<string, Node<T>>;
  param?: { name: string; node: Node<T> };
  wildcard?: { name: string; node: Node<T> };
  handlers: Map<string, T>;
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
    for (const s of segs) {
      if (s.kind === "static") {
        let next = node.static.get(s.value);
        if (!next) {
          next = newNode();
          node.static.set(s.value, next);
        }
        node = next;
      } else if (s.kind === "param") {
        if (!node.param) node.param = { name: s.name, node: newNode() };
        node = node.param.node;
      } else {
        if (!node.wildcard) node.wildcard = { name: s.name, node: newNode() };
        node = node.wildcard.node;
        break;
      }
    }
    node.handlers.set(method.toUpperCase(), handler);
  }

  find(method: string, path: string): MatchResult<T> | null {
    const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
    const parts = trimmed === "" ? [] : trimmed.split("/");
    return this.walk(this.root, parts, 0, {}, method.toUpperCase());
  }

  private walk(
    node: Node<T>,
    parts: string[],
    idx: number,
    params: Record<string, string>,
    method: string,
  ): MatchResult<T> | null {
    if (idx === parts.length) {
      const handler = node.handlers.get(method);
      return handler !== undefined ? { handler, params } : null;
    }
    const part = parts[idx]!;
    const staticChild = node.static.get(part);
    if (staticChild) {
      const r = this.walk(staticChild, parts, idx + 1, params, method);
      if (r) return r;
    }
    if (node.param) {
      const r = this.walk(
        node.param.node,
        parts,
        idx + 1,
        { ...params, [node.param.name]: part },
        method,
      );
      if (r) return r;
    }
    if (node.wildcard) {
      const rest = parts.slice(idx).join("/");
      const handler = node.wildcard.node.handlers.get(method);
      if (handler !== undefined) {
        return { handler, params: { ...params, [node.wildcard.name]: rest } };
      }
    }
    return null;
  }
}
