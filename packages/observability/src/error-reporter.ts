import type { Middleware, ZebraRequest } from "@zebra-web/core";

import { getRequestId } from "./request-id.ts";

export interface ErrorReporterInfo {
  method: string;
  path: string;
  requestId: string | undefined;
}

/**
 * Error reporter middleware: runs inside `next()` so it observes thrown
 * errors before core's error middleware converts them to Problem+Json. The
 * reporter is invoked with the original error plus request context; the error
 * is always rethrown unchanged and a throwing reporter never masks it.
 */
export function errorReporter(
  reporter: (error: unknown, req: ZebraRequest, info: ErrorReporterInfo) => void,
): Middleware {
  return async (req, next) => {
    try {
      return await next();
    } catch (error) {
      try {
        reporter(error, req, {
          method: req.raw.method,
          path: req.url.pathname,
          requestId: getRequestId(req),
        });
      } catch (reporterError) {
        console.error("[zebra/errorReporter] reporter threw:", reporterError);
      }
      throw error;
    }
  };
}
