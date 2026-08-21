import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ContractProcedureDef } from "@zebra/contract";

/** Namespaced MCP tool arguments (`{ params, query, body }`), mirroring the client. */
export interface McpArguments {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
}

function substitutePath(path: string, params: Record<string, unknown>): string {
  const withParams = path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing required path parameter ":${name}"`);
    return encodeURIComponent(String(value));
  });
  return withParams.replace(/\*([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing required path parameter "*${name}"`);
    return String(value).split("/").map(encodeURIComponent).join("/");
  });
}

/**
 * Maps MCP tool arguments to a raw `Request` the Zebra dispatch pipeline can
 * consume: path params are substituted and URL-encoded, query params become the
 * query string, and the body is JSON-serialized (with an inferred content-type).
 */
export function argumentsToRequest(
  def: ContractProcedureDef,
  args: unknown,
  baseUrl: string,
  extraHeaders: Record<string, string>,
  init?: { signal?: AbortSignal },
): Request {
  const { params = {}, query = {}, body, headers = {} } = (args ?? {}) as McpArguments;
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}${substitutePath(def.path, params)}`;

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    url.searchParams.append(key, String(value));
  }

  const mergedHeaders: Record<string, string> = { ...extraHeaders, ...headers };
  const requestInit: RequestInit = { method: def.method };
  if (init?.signal !== undefined) requestInit.signal = init.signal;
  if (body !== undefined) {
    if (mergedHeaders["content-type"] === undefined) {
      mergedHeaders["content-type"] = "application/json";
    }
    requestInit.body = JSON.stringify(body);
  }
  if (Object.keys(mergedHeaders).length > 0) requestInit.headers = mergedHeaders;

  return new Request(url.toString(), requestInit);
}

/**
 * Maps a dispatch `Response` to an MCP `CallToolResult`:
 * - 204 → empty result
 * - 2xx JSON → text content + structuredContent (when the body is a JSON object)
 * - other 2xx (text/HTML/...) → text content
 * - non-2xx (Problem+Json or raw) → `isError: true` tool error with the body as text
 */
export async function responseToResult(res: Response): Promise<CallToolResult> {
  if (res.status === 204) return { content: [] };

  const text = await res.text();
  const json = tryJson(text);

  if (res.ok) {
    const content = [
      { type: "text" as const, text: json !== undefined ? JSON.stringify(json) : text },
    ];
    if (json !== undefined && typeof json === "object" && json !== null && !Array.isArray(json)) {
      return { content, structuredContent: json as Record<string, unknown> };
    }
    return { content };
  }

  return {
    content: [{ type: "text" as const, text: json !== undefined ? JSON.stringify(json) : text }],
    isError: true,
  };
}

function tryJson(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
