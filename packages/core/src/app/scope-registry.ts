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
  private readonly pendingDisposals = new Set<Promise<void>>();
  private disposingAll: Promise<void> | null = null;

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
    const errors: unknown[] = [];
    try {
      await scopes.request.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (scopes.ephemeralSession) {
      try {
        await scopes.ephemeralSession.dispose();
      } catch (error) {
        errors.push(error);
      }
    } else if (scopes.sessionId !== undefined) {
      this.releaseSession(scopes.sessionId);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Failed to dispose request scopes");
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
    await this.disposeRecord(record);
  }

  /** Reclaims every session container (shutdown). */
  async disposeAll(): Promise<void> {
    if (this.disposingAll) return this.disposingAll;
    this.disposingAll = Promise.resolve().then(() => this.performDisposeAll());
    try {
      await this.disposingAll;
    } finally {
      this.disposingAll = null;
    }
  }

  private async performDisposeAll(): Promise<void> {
    const records = [...this.sessions.values()];
    this.sessions.clear();
    // Cancel every timer before awaiting any resource: another session must
    // not expire in the middle of this ordered shutdown.
    for (const record of records) {
      if (record.timer) clearTimeout(record.timer);
    }
    // Explicit disposal or expiry may already have removed a session from
    // the map. Its cleanup still has to finish before shutdown can complete.
    const pending = Promise.allSettled([...this.pendingDisposals]);
    const errors: unknown[] = [];
    for (const record of records) {
      try {
        await this.disposeRecord(record);
      } catch (error) {
        errors.push(error);
      }
    }
    for (const result of await pending) {
      if (result.status === "rejected") errors.push(result.reason);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Failed to dispose sessions");
  }

  private async disposeRecord(record: SessionScopeRecord): Promise<void> {
    const disposal = Promise.resolve().then(() => record.container.dispose());
    this.pendingDisposals.add(disposal);
    try {
      await disposal;
    } finally {
      this.pendingDisposals.delete(disposal);
    }
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
      void this.expireSession(id).catch((error) => {
        console.error("[zebra] session cleanup failed:", error);
      });
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
