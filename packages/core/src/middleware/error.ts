import { HttpError, toProblemJson } from "../http/errors.ts";
import type { Middleware } from "./types.ts";

export function errorMiddleware(opts: { exposeStack: boolean }): Middleware {
  return async (req, next) => {
    try {
      return await next();
    } catch (err) {
      const problem = toProblemJson(err, req.url.pathname, { exposeStack: opts.exposeStack });
      const headers: Record<string, string> = {
        "content-type": "application/problem+json; charset=utf-8",
      };
      if (err instanceof HttpError && err.headers) {
        for (const [key, value] of Object.entries(err.headers)) {
          headers[key.toLowerCase()] = value;
        }
      }
      return new Response(JSON.stringify(problem), {
        status: problem.status,
        headers,
      });
    }
  };
}
