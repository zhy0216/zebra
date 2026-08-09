import { HttpError, getSession, middleware } from "zebra";
import { ForumStore, type User } from "./services.ts";

// ---------------------------------------------------------------------------
// Authentication: a dep-aware middleware ("middleware()" resolves named deps
// from the container per request) reads the session cookie and stashes the
// current user on req.ctx — the same pattern getSession(req) uses. Routes read
// it via getCurrentUser(req); requireAuth() guards write routes.
// ---------------------------------------------------------------------------

export const CURRENT_USER = Symbol.for("forum.currentUser");

export function getCurrentUser(req: { ctx: Map<symbol, unknown> }): User | undefined {
  return req.ctx.get(CURRENT_USER) as User | undefined;
}

/** Global: resolves the logged-in user (if any) and attaches it to req.ctx. */
export const attachUser = middleware({ store: ForumStore }, async (req, next, { store }) => {
  const session = getSession(req);
  const userId = session === undefined ? undefined : await session.get<number>("userId");
  const user = typeof userId === "number" ? store.findUserById(userId) : undefined;
  req.ctx.set(CURRENT_USER, user);
  return next();
});

/** Per-route: rejects anonymous requests with a 401 Problem+Json. */
export function requireAuth() {
  return async (req: { ctx: Map<symbol, unknown> }, next: () => Promise<Response>) => {
    if (getCurrentUser(req) === undefined) {
      throw new HttpError(401, "unauthorized", "Authentication required");
    }
    return next();
  };
}
