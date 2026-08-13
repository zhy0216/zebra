// C4: per-request session handle exposed via `req.ctx` (`getSession(req)`).
//
// Data is loaded lazily from the store on first access and cached for the
// rest of the request. Mutations (`set`/`delete`) mark the session dirty;
// the middleware persists at response end (or earlier via explicit `flush`).

import type { SessionStore } from "./store.ts";

/** Key under which the middleware stores the session on `req.ctx`. */
export const SESSION_KEY: symbol = Symbol.for("zebra.session");

/**
 * Key under which the middleware stashes Set-Cookie values that must survive
 * an error response (a first-time visitor whose handler threw still gets a
 * sid cookie; a destroyed session still gets the expiring one). The core
 * error middleware reads this key by its `Symbol.for` registration and
 * appends the values after building the problem response — the two packages
 * stay decoupled (core has no dependency on `@zebra/session`).
 */
export const PENDING_SET_COOKIES: symbol = Symbol.for("zebra.set-cookie");

/** Read/write handle to the current request's session. */
export interface RequestSession {
  /** Verified session id (newly generated for first-time visitors). */
  readonly id: string;
  /** True when this request created the session (no valid sid cookie). */
  readonly isNew: boolean;
  /** Value at `key`, loading session data lazily on first access. */
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** Sets `key` and marks the session dirty (persisted at response end). */
  set(key: string, value: unknown): Promise<void>;
  /** Removes `key` and marks the session dirty (persisted at response end). */
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  /** The full data record (lazily loaded and cached per request); a shallow copy. */
  data(): Promise<Record<string, unknown>>;
  /** Persists immediately; the middleware also persists at response end. */
  flush(): Promise<void>;
  /**
   * Destroys the session: removes its data from the store and marks the
   * session so the response carries an expiring `Set-Cookie` (Max-Age=0).
   * The handle is inert afterwards — no further mutation is persisted and
   * the old cookie can no longer revive the session (anti-fixation).
   */
  destroy(): Promise<void>;
}

/** Internal surface used by the middleware; not part of the public API. */
export interface RequestSessionInternal extends RequestSession {
  isDirty(): boolean;
  isDestroyed(): boolean;
  clearDirty(): void;
}

export interface CreateSessionOptions {
  id: string;
  isNew: boolean;
  store: SessionStore;
  /** Pre-loaded data record; avoids a redundant `store.get` on first access. */
  initial?: Record<string, unknown>;
}

export function createSession(options: CreateSessionOptions): RequestSessionInternal {
  let cached: Record<string, unknown> | undefined =
    typeof options.initial === "object" && options.initial !== null
      ? cloneRecord(options.initial)
      : undefined;
  let dirty = false;
  let destroyed = false;

  const load = async (): Promise<Record<string, unknown>> => {
    if (cached === undefined) {
      const stored = await options.store.get(options.id);
      cached =
        stored !== null && typeof stored === "object"
          ? cloneRecord(stored as Record<string, unknown>)
          : {};
    }
    return cached;
  };

  return {
    id: options.id,
    isNew: options.isNew,
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return (await load())[key] as T | undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      (await load())[key] = value;
      dirty = true;
    },
    async delete(key: string): Promise<void> {
      delete (await load())[key];
      dirty = true;
    },
    async has(key: string): Promise<boolean> {
      return key in (await load());
    },
    // Returns a shallow copy: mutating the returned object must not silently
    // bypass the dirty tracking (only `set`/`delete` are persisted).
    data: async () => ({ ...(await load()) }),
    async flush(): Promise<void> {
      if (!destroyed && dirty) {
        await options.store.set(options.id, await load());
        dirty = false;
      }
    },
    async destroy(): Promise<void> {
      destroyed = true;
      dirty = false;
      try {
        await options.store.destroy(options.id);
      } catch {
        // Keep the handle inert even when the store backend failed: the
        // response still carries the expiring Set-Cookie, so the client drops
        // the cookie. Note the record may linger (store TTL expires it), so a
        // replayed cookie could still match a leftover record until then —
        // fail-open logout, acceptable since the client no longer holds it.
      }
    },
    isDirty: () => dirty,
    isDestroyed: () => destroyed,
    clearDirty: () => {
      dirty = false;
    },
  };
}

/**
 * Shallow-copies session data so concurrent requests on the same session id
 * never share (and silently overwrite) the same top-level object. Nested
 * objects are still shared between requests — treat them as immutable, or
 * replace them wholesale via `set`/`delete` (only those are persisted).
 */
function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return { ...record };
}

/**
 * Reads the session attached to `req.ctx` by the middleware.
 * Returns `undefined` when no session middleware ran (or `app.use` was skipped).
 */
export function getSession(req: { ctx: Map<symbol, unknown> }): RequestSession | undefined {
  return req.ctx.get(SESSION_KEY) as RequestSession | undefined;
}
