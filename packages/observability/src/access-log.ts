import type { Middleware } from "@zebra/core";

import { getRequestId } from "./request-id.ts";

export interface AccessLogEntry {
  method: string;
  path: string;
  /** Response status; `undefined` when the handler threw before responding. */
  status: number | undefined;
  durationMs: number;
  requestId: string | undefined;
  /** Epoch milliseconds when the request started. */
  timestamp: number;
  /** Set when the handler threw; the middleware rethrows unchanged. */
  error?: unknown;
}

export interface AccessLogOptions {
  /** Custom sink. Default: `console.log` with a single-line formatted entry. */
  writer?: (entry: AccessLogEntry) => void;
}

function formatEntry(entry: AccessLogEntry): string {
  const status = entry.status === undefined ? "-" : String(entry.status);
  const requestId = entry.requestId ?? "-";
  return `${new Date(entry.timestamp).toISOString()} ${entry.method} ${entry.path} ${status} ${entry.durationMs.toFixed(1)}ms ${requestId}`;
}

const DEFAULT_WRITER = (entry: AccessLogEntry): void => {
  console.log(formatEntry(entry));
};

function safeWrite(writer: (entry: AccessLogEntry) => void, entry: AccessLogEntry): void {
  try {
    writer(entry);
  } catch (error) {
    console.error("[zebra/accessLog] writer threw:", error);
  }
}

/**
 * Access log middleware: records one entry per request (method, path, status,
 * duration, request id, timestamp) via the configured writer. Handler errors
 * are recorded on the entry and rethrown unchanged — core still converts them
 * into the Problem+Json response.
 */
export function accessLog(options: AccessLogOptions = {}): Middleware {
  const writer = options.writer ?? DEFAULT_WRITER;
  return async (req, next) => {
    const start = performance.now();
    const method = req.raw.method;
    const path = req.url.pathname;
    const requestId = getRequestId(req);
    const timestamp = Date.now();
    try {
      const res = await next();
      safeWrite(writer, {
        method,
        path,
        status: res.status,
        durationMs: performance.now() - start,
        requestId,
        timestamp,
      });
      return res;
    } catch (error) {
      safeWrite(writer, {
        method,
        path,
        status: undefined,
        durationMs: performance.now() - start,
        requestId,
        timestamp,
        error,
      });
      throw error;
    }
  };
}
