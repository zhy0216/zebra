// C4: real session middleware.
//
// Assembly: core runs the session resolver *before* composed middleware
// (`dispatch` → `createRequestScopes`), so the middleware cannot feed a
// runtime-parsed id into the resolver. Instead `sessionMiddleware` also
// exposes a `resolver` — a pure function of the raw request (cookie → verify
// → session id) — which the user wires at construction:
//
//   const mw = sessionMiddleware({ secret, store });
//   const app = new Zebra({ session: { resolver: mw.resolver, ttl } });
//   app.use(mw);
//
// At runtime the middleware re-parses the cookie to attach `req.ctx.session`.
// Persistence happens on the response path (after `next()`, even on error):
// new/dirty sessions are written, unchanged ones are touched (rolling renewal).
//
// C5: session lifecycle boundaries.
// - TTL ownership: the *store* TTL owns the data lifecycle — a session id is
//   alive iff the store holds a record for it. Core's session TTL only
//   reclaims the DI scope container (`app.disposeSession` clears container
//   + timer, never store data), so the two expiries are independent by design.
// - Server-side teardown: `session.destroy()` removes the store record and
//   marks the response to carry an expiring Set-Cookie (Max-Age=0); the
//   destroyed session is never re-persisted. `mw.destroySession(id)` is the
//   app-facing helper for the same store teardown (public on the returned
//   middleware object). Core's `app.disposeSession(id)` — public on the
//   Zebra instance — additionally reclaims the scope container and may be
//   called alongside when immediate container GC is wanted.
// - Anti-fixation: the HMAC signature only proves the cookie is genuine, not
//   that the session still lives. Both the resolver and `openSession`
//   therefore check the store before reusing an id: a verified id with no
//   record (destroyed or TTL-expired) is treated as a new visitor — a fresh
//   sid + cookie replace the stale one instead of resurrecting the old
//   session. Consulting the store in the resolver keeps core's session scope
//   (DI container keyed by session id) consistent with the middleware, so a
//   destroyed session never revives a DI scope either. `MemoryStore` also
//   tombstones destroyed ids to block in-flight `set` calls from
//   resurrecting them.

import type { Middleware } from "@zebra/core";

import { type CookieSerializeOptions, parseSignedCookie, serializeCookie } from "./cookie.ts";
import {
  PENDING_SET_COOKIES,
  type RequestSession,
  type RequestSessionInternal,
  SESSION_KEY,
  createSession,
} from "./session.ts";
import { sign } from "./sign.ts";
import { MemoryStore, type SessionStore } from "./store.ts";

export interface SessionCookieOptions extends CookieSerializeOptions {
  name?: string;
  /**
   * Hardened cookie preset, applied by default: `HttpOnly` + `SameSite=Lax`.
   * Pass `preset: "plain"` to opt out (a flag-free cookie — the original
   * default). Explicit per-attribute options (e.g. `httpOnly: false` or
   * `sameSite: "strict"`) override the preset either way.
   */
  preset?: "secure" | "plain";
}

/** Secure session cookie attributes: `HttpOnly` + `SameSite=Lax`. */
export const SECURE_COOKIE: CookieSerializeOptions = Object.freeze({
  httpOnly: true,
  sameSite: "lax",
});

export interface SessionMiddlewareOptions {
  secret: string;
  cookie?: SessionCookieOptions;
  store?: SessionStore;
}

/** Maps a raw request to its verified session id (`undefined` = anonymous). */
export type SessionResolver = (req: Request) => string | undefined | Promise<string | undefined>;

/** The middleware, with the construction-time `resolver` attached. */
export type SessionMiddleware = Middleware & {
  resolver: SessionResolver;
  /**
   * Server-side teardown of one session: removes its data from the store so a
   * stale cookie can no longer revive it (anti-fixation). Data lifecycle is
   * store-owned; core's `app.disposeSession(id)` (public on the Zebra
   * instance) only reclaims the DI scope container and can be called
   * alongside when immediate container GC is wanted.
   */
  destroySession(id: string): Promise<void>;
  /**
   * C4: 把连接级会话句柄挂到 `ws.data.session`。
   *
   * 作为 core `ZebraOptions.session.wsSession` 的默认实现使用：
   *
   *   const mw = sessionMiddleware({ secret, store });
   *   const app = new Zebra({ session: { resolver: mw.resolver, wsSession: mw.wsSession } });
   *   app.ws("/chat/:room", {
   *     open(ws, data) { const s = data.session; /* RequestSession | undefined *\/ },
   *   });
   *
   * `sessionId` 是 core 在升级请求上经 `resolver` 解析并验证的结果（存活会话才
   * 有 id，见 resolver 的 anti-fixation 检查），此处直接复用，返回一个可读写的
   * `RequestSession`（数据按需从 store 懒加载；写入需显式 `flush()`，ws 连接
   * 没有 HTTP 响应路径的自动持久化）。匿名连接（`sessionId` 为 `undefined`）
   * 返回 `undefined`——升级响应无法回发 Set-Cookie，伪造新 id 只会产生客户端
   * 拿不到的孤儿记录。
   */
  wsSession(req: Request, sessionId: string | undefined): Promise<RequestSession | undefined>;
};

const DEFAULT_COOKIE_NAME = "sid";
const DEFAULT_COOKIE_PATH = "/";
const DEFAULT_STORE_TTL = 30 * 60 * 1000;

export function sessionMiddleware(options: SessionMiddlewareOptions): SessionMiddleware {
  if (!options.secret) throw new Error("sessionMiddleware: secret is required");
  const secret = options.secret;
  const store = options.store ?? new MemoryStore({ ttl: DEFAULT_STORE_TTL });
  const cookieName = options.cookie?.name ?? DEFAULT_COOKIE_NAME;
  const { preset, ...cookieAttrs } = options.cookie ?? {};
  const cookieOptions: CookieSerializeOptions = {
    path: DEFAULT_COOKIE_PATH,
    // HttpOnly + SameSite=Lax by default; `preset: "plain"` restores the
    // flag-free cookie. Explicit attributes always win over the preset.
    ...(preset === "plain" ? {} : SECURE_COOKIE),
    ...cookieAttrs,
  };

  const resolver: SessionResolver = async (raw) => {
    const sid = parseSignedCookie(raw.headers.get("cookie"), cookieName, secret);
    if (sid === null) return undefined;
    // The store owns the data lifecycle: a verified id with no live record
    // (destroyed / TTL-expired) is anonymous. Checking here keeps core's
    // session scope consistent with the middleware (anti-fixation, see header).
    const stored = await store.get(sid);
    return stored === undefined ? undefined : sid;
  };

  const mw: Middleware = async (req, next) => {
    const session = await openSession(req, store, secret, cookieName);
    req.ctx.set(SESSION_KEY, session);
    try {
      const res = await next();
      if (session.isDestroyed()) {
        return appendSetCookie(res, expireCookie(cookieName, cookieOptions));
      }
      await persistSession(store, session);
      if (session.isNew) {
        return appendSetCookie(
          res,
          serializeCookie(cookieName, sign(session.id, secret), cookieOptions),
        );
      }
      return res;
    } catch (error) {
      // A failing handler still owns the session lifecycle: persist what was
      // written, and make sure the error response carries the same cookie the
      // success path would have issued — the core error middleware appends
      // the stashed values after it builds the problem response.
      if (session.isDestroyed()) {
        stashSetCookie(req, expireCookie(cookieName, cookieOptions));
      } else {
        try {
          await persistSession(store, session);
        } catch {
          // Persistence failure must not mask the original error.
        }
        if (session.isNew) {
          stashSetCookie(req, serializeCookie(cookieName, sign(session.id, secret), cookieOptions));
        }
      }
      throw error;
    }
  };
  (mw as any).resolver = resolver;
  (mw as any).destroySession = async (id: string): Promise<void> => {
    await store.destroy(id);
  };
  (mw as any).wsSession = async (
    _req: Request,
    sessionId: string | undefined,
  ): Promise<RequestSession | undefined> => {
    // resolver 已确认该 id 在 store 中存活（见头部 anti-fixation 注释），直接复用；
    // 匿名连接不伪造会话（upgrade 响应无法回发 Set-Cookie，见类型注释）。
    if (sessionId === undefined) return undefined;
    return createSession({ id: sessionId, isNew: false, store });
  };
  return mw as SessionMiddleware;
}

async function openSession(
  req: { headers: Headers; ctx: Map<symbol, unknown> },
  store: SessionStore,
  secret: string,
  cookieName: string,
): Promise<RequestSessionInternal> {
  const sid = parseSignedCookie(req.headers.get("cookie"), cookieName, secret);
  if (sid !== null) {
    // C5 anti-fixation: a valid signature only proves the cookie is genuine,
    // not that the session still lives. An id with no store record
    // (destroyed / TTL-expired) must not be revived — fall through and treat
    // the request as a new visitor so the stale cookie gets replaced.
    const stored = await store.get(sid);
    if (stored !== undefined) {
      const initial =
        typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
      return createSession({ id: sid, isNew: false, store, initial });
    }
  }
  return createSession({ id: crypto.randomUUID(), isNew: true, store });
}

async function persistSession(store: SessionStore, session: RequestSessionInternal): Promise<void> {
  // A brand-new visitor that never wrote data has nothing to persist; writing
  // an empty record would grow the store with every anonymous request.
  if (session.isNew && !session.isDirty()) return;
  if (session.isNew || session.isDirty()) {
    await store.set(session.id, await session.data());
    session.clearDirty();
  } else {
    await store.touch(session.id);
  }
}

function appendSetCookie(res: Response, cookie: string): Response {
  const headers = new Headers(res.headers);
  headers.append("set-cookie", cookie);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Queues a cookie for the error path; the core error middleware reads
 * `PENDING_SET_COOKIES` and appends each value to the problem response. */
function stashSetCookie(req: { ctx: Map<symbol, unknown> }, cookie: string): void {
  const list = req.ctx.get(PENDING_SET_COOKIES);
  if (Array.isArray(list)) {
    list.push(cookie);
  } else {
    req.ctx.set(PENDING_SET_COOKIES, [cookie]);
  }
}

/** Set-Cookie that instructs the client to drop the cookie (Max-Age=0). */
function expireCookie(name: string, options: CookieSerializeOptions): string {
  return serializeCookie(name, "", { ...options, maxAge: 0 });
}
