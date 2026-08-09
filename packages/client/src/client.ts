import { ClientError } from "./error.ts";
import { isProcedure, type ContractProcedureDef, type ProblemJson } from "./protocol.ts";
import type { ClientOptions, ClientProcedure, ContractClient, ContractRouter } from "./types.ts";

function substitutePath(path: string, params: Record<string, unknown>): string {
  const withParams = path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing required path parameter ":${name}"`);
    return encodeURIComponent(String(value));
  });
  return withParams.replace(/\*([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing required path parameter "*${name}"`);
    return String(value)
      .split("/")
      .map(encodeURIComponent)
      .join("/");
  });
}

async function problemFrom(res: Response): Promise<ProblemJson> {
  try {
    const body = (await res.json()) as Partial<ProblemJson>;
    if (body !== null && typeof body === "object" && typeof body.type === "string") {
      return body as ProblemJson;
    }
  } catch {
    // non-JSON error body
  }
  return {
    type: "https://errors.zebra.dev/request_failed",
    status: res.status,
    title: `Request failed with status ${res.status}`,
    instance: new URL(res.url).pathname,
  };
}

function makeCall(
  def: ContractProcedureDef,
  doFetch: (url: string, init: RequestInit) => Promise<Response>,
  baseUrl: string,
  resolveHeaders: () => Record<string, string>,
): ClientProcedure<ContractProcedureDef> {
  return async (args) => {
    const { params = {}, query = {}, body, headers = {}, signal } = (args ?? {}) as {
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      body?: unknown;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    };

    const url = new URL(`${baseUrl}${substitutePath(def.path, params)}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.append(key, String(value));
    }

    const init: RequestInit = {
      method: def.method,
      ...(signal !== undefined ? { signal } : {}),
    };
    const mergedHeaders = { ...resolveHeaders(), ...headers };
    if (body !== undefined) {
      if (mergedHeaders["content-type"] === undefined) {
        mergedHeaders["content-type"] = "application/json";
      }
      init.body = JSON.stringify(body);
    }
    if (Object.keys(mergedHeaders).length > 0) init.headers = mergedHeaders;

    const res = await doFetch(url.toString(), init);
    if (!res.ok) {
      throw new ClientError(res.status, codeFrom(res.status), await problemFrom(res), res);
    }
    if (res.status === 204 || def.status === 204) return undefined;
    const text = await res.text();
    if (text === "") return undefined;
    return JSON.parse(text);
  };
}

function codeFrom(status: number): string {
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 422:
      return "validation_failed";
    default:
      return `http_${status}`;
  }
}

/** Build a type-safe client from a contract router (types only; no runtime validation). */
export function createClient<R extends ContractRouter>(
  router: R,
  opts: ClientOptions,
): ContractClient<R> {
  const doFetch = opts.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const resolveHeaders = (): Record<string, string> =>
    typeof opts.headers === "function" ? opts.headers() : (opts.headers ?? {});

  const build = (node: ContractRouter): unknown => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (isProcedure(value)) out[key] = makeCall(value.def, doFetch, opts.baseUrl, resolveHeaders);
      else out[key] = build(value as ContractRouter);
    }
    return out;
  };

  return build(router) as ContractClient<R>;
}
