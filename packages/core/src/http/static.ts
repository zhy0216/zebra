import { resolve, sep } from "node:path";

export interface StaticOptions {
  index: string;
  maxAge: number;
}

export async function serveStatic(
  root: string,
  requested: string,
  opts: StaticOptions,
): Promise<Response> {
  const decoded = decodeURIComponent(requested);
  const target = decoded === "" ? opts.index : decoded;

  if (target.startsWith("/") || target.startsWith("\\")) {
    return new Response("Forbidden", { status: 403 });
  }

  const absRoot = resolve(root);
  const absTarget = resolve(absRoot, target);
  if (!absTarget.startsWith(absRoot + sep) && absTarget !== absRoot) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = Bun.file(absTarget);
  if (!(await file.exists())) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(file, {
    status: 200,
    headers: {
      "content-type": file.type || "application/octet-stream",
      "cache-control": `public, max-age=${opts.maxAge}`,
    },
  });
}
