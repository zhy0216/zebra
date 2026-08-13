import { Container } from "../di/container.ts";
import { ScopeKind } from "../di/scope.ts";

const MAX_SESSION_ID_LENGTH = 512;

export interface SessionScopeRecord {
  container: Container;
  timer: ReturnType<typeof setTimeout> | undefined;
  activeRequests: number;
}

export interface RequestScopes {
  request: Container;
  ephemeralSession?: Container;
  sessionId?: string;
}

/**
 * Owns the per-session DI scope containers and their idle-expiry timers.
 * Extracted from the app class so the session machinery lives in one place;
 * `AppInternals` holds an instance and delegates all session-scope work here.
 */
export class SessionScopeRegistry {
  private readonly sessions = new Map<string, SessionScopeRecord>();

  constructor(
    private readonly container: Container,
    private readonly sessionResolver:
      | ((req: Request) => string | undefined | Promise<string | undefined>)
      | undefined,
    private readonly sessionTtl: number,
  ) {}

  /** True when a session resolver is configured (dispatch needs session scopes). */
  hasResolver(): boolean {
    return this.sessionResolver !== undefined;
  }

  /**
   * Resolves the session id for the raw request and creates (or reuses) the
   * matching session/request DI scopes. Anonymous requests get an ephemeral
   * session scope disposed with the request.
   */
  async createRequestScopes(raw: Request): Promise<RequestScopes> {
    const resolved = await this.sessionResolver?.(raw);
    const sessionId =
      typeof resolved === "string" &&
      resolved.length > 0 &&
      resolved.length <= MAX_SESSION_ID_LENGTH
        ? resolved
        : undefined;
    if (sessionId === undefined) {
      const session = this.container.createChildScope(ScopeKind.Session);
      return {
        request: session.createChildScope(ScopeKind.Request),
        ephemeralSession: session,
      };
    }

    let record = this.sessions.get(sessionId);
    if (!record) {
      const container = this.container.createChildScope(ScopeKind.Session);
      record = { container, timer: undefined, activeRequests: 0 };
      this.sessions.set(sessionId, record);
    } else if (record.timer) {
      clearTimeout(record.timer);
      record.timer = undefined;
    }
    record.activeRequests++;
    return {
      request: record.container.createChildScope(ScopeKind.Request),
      sessionId,
    };
  }

  /** Disposes the request scope and releases (or expires) the session. */
  async disposeScopes(scopes: RequestScopes): Promise<void> {
    let cleanupError: unknown;
    try {
      await scopes.request.dispose();
    } catch (error) {
      cleanupError = error;
    }
    if (scopes.ephemeralSession) {
      try {
        await scopes.ephemeralSession.dispose();
      } catch (error) {
        cleanupError ??= error;
      }
    } else if (scopes.sessionId !== undefined) {
      this.releaseSession(scopes.sessionId);
    }
    if (cleanupError !== undefined) throw cleanupError;
  }

  /**
   * Explicit, unconditional teardown of one session container (public escape
   * hatch — does not consult `activeRequests`).
   */
  async disposeSession(id: string): Promise<void> {
    const record = this.sessions.get(id);
    if (!record) return;
    this.sessions.delete(id);
    if (record.timer) clearTimeout(record.timer);
    await record.container.dispose();
  }

  /** Reclaims every session container (shutdown). */
  async disposeAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.disposeSession(id);
  }

  private releaseSession(id: string): void {
    const record = this.sessions.get(id);
    if (!record) return;
    record.activeRequests = Math.max(0, record.activeRequests - 1);
    if (record.activeRequests === 0) {
      // Drop any stale timer before arming a fresh one — an orphaned timer
      // must never fire against a session that has since been re-activated.
      if (record.timer) {
        clearTimeout(record.timer);
        record.timer = undefined;
      }
      record.timer = this.scheduleSessionExpiry(id);
    }
  }

  private scheduleSessionExpiry(id: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      void this.expireSession(id);
    }, this.sessionTtl);
    timer.unref?.();
    return timer;
  }

  /**
   * Timer-driven expiry: re-arms when a request re-entered the session in the
   * meantime instead of disposing a live container. The public
   * `disposeSession(id)` remains the explicit, unconditional escape hatch.
   */
  private async expireSession(id: string): Promise<void> {
    const record = this.sessions.get(id);
    if (!record) return;
    if (record.activeRequests > 0) {
      record.timer = this.scheduleSessionExpiry(id);
      return;
    }
    await this.disposeSession(id);
  }
}
