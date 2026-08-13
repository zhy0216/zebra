import { HttpError, toProblemJson } from "../http/errors.ts";
import type { Middleware } from "./types.ts";

export function errorMiddleware(opts: { exposeStack: boolean }): Middleware {
  return async (req, next) => {
    try {
      return await next();
    } catch (err) {
      const problem = toProblemJson(err, req.url.pathname, { exposeStack: opts.exposeStack });
      const headers = new Headers({
        "content-type": "application/problem+json; charset=utf-8",
      });
      if (err instanceof HttpError && err.headers) {
        for (const [key, value] of Object.entries(err.headers)) {
          headers.set(key.toLowerCase(), value);
        }
      }
      // Middleware may stash Set-Cookie values that must survive error
      // responses (e.g. the session middleware issuing a sid cookie to a
      // first-time visitor whose handler threw). Appended individually —
      // set-cookie is the one header that must never be comma-joined.
      const pending = req.ctx?.get(Symbol.for("zebra.set-cookie"));
      if (Array.isArray(pending)) {
        for (const cookie of pending) {
          if (typeof cookie === "string") headers.append("set-cookie", cookie);
        }
      }
      return new Response(JSON.stringify(problem), {
        status: problem.status,
        headers,
      });
    }
  };
}
