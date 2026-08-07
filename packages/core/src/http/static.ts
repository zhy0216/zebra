import { resolve, sep } from "node:path";

export interface StaticOptions {
  index: string;
  maxAge: number;
}

interface ByteRange {
  start: number;
  end: number;
}

function parseRange(value: string, size: number): ByteRange | null {
  if (size <= 0) return null;
  if (!value.startsWith("bytes=") || value.includes(",")) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match) return null;

  const [, startText = "", endText = ""] = match;
  if (startText === "" && endText === "") return null;

  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(startText);
  const requestedEnd = endText === "" ? size - 1 : Number(endText);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

export async function serveStatic(
  root: string,
  requested: string,
  opts: StaticOptions,
  requestHeaders: Headers = new Headers(),
): Promise<Response> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
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

  const etag = `W/"${file.lastModified}-${file.size}"`;
  const headers = new Headers({
    "content-type": file.type || "application/octet-stream",
    "cache-control": `public, max-age=${opts.maxAge}`,
    "accept-ranges": "bytes",
    etag,
    "last-modified": new Date(file.lastModified).toUTCString(),
  });

  const ifNoneMatch = requestHeaders.get("if-none-match");
  if (
    ifNoneMatch
      ?.split(",")
      .map((candidate) => candidate.trim())
      .some((candidate) => candidate === "*" || candidate === etag)
  ) {
    return new Response(null, { status: 304, headers });
  }

  const requestedRange = requestHeaders.get("range");
  if (requestedRange !== null) {
    const range = parseRange(requestedRange, file.size);
    if (!range) {
      headers.set("content-range", `bytes */${file.size}`);
      return new Response(null, { status: 416, headers });
    }
    const length = range.end - range.start + 1;
    headers.set("content-range", `bytes ${range.start}-${range.end}/${file.size}`);
    headers.set("content-length", String(length));
    return new Response(file.slice(range.start, range.end + 1), {
      status: 206,
      headers,
    });
  }

  headers.set("content-length", String(file.size));

  return new Response(file, {
    status: 200,
    headers,
  });
}
