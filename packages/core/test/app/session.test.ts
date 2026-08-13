import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { injectable } from "../../src/di/decorators.ts";

@injectable()
class SessionState {
  static nextId = 0;
  static disposed: number[] = [];
  readonly id = ++SessionState.nextId;

  dispose() {
    SessionState.disposed.push(this.id);
  }
}

function sessionApp(ttl = 30 * 60 * 1000): Zebra {
  const app = new Zebra({
    session: {
      ttl,
      resolver: (req) => req.headers.get("x-session") ?? undefined,
    },
  });
  app.injectSession(SessionState);
  app.get("/session", { state: SessionState }, async (_req, { state }) => state.id);
  return app;
}

async function requestId(app: Zebra, session?: string): Promise<number> {
  const headers = session ? { "x-session": session } : undefined;
  const response = await app.dispatch(new Request("http://x/session", { headers }));
  return response.json() as Promise<number>;
}

test("session scope reuses instances by id and isolates different sessions", async () => {
  SessionState.nextId = 0;
  SessionState.disposed = [];
  const app = sessionApp();

  const first = await requestId(app, "a");
  expect(await requestId(app, "a")).toBe(first);
  expect(await requestId(app, "b")).not.toBe(first);

  await app.disposeSession("a");
  expect(SessionState.disposed).toContain(first);
  expect(await requestId(app, "a")).not.toBe(first);
  await app.stop();
});

test("anonymous session-scoped instances are request-local and disposed", async () => {
  SessionState.nextId = 0;
  SessionState.disposed = [];
  const app = sessionApp();

  const first = await requestId(app);
  const second = await requestId(app);
  expect(second).not.toBe(first);
  expect(SessionState.disposed).toEqual([first, second]);
  await app.stop();
});

test("session scope expires after the idle TTL", async () => {
  SessionState.nextId = 0;
  SessionState.disposed = [];
  const app = sessionApp(10);

  const first = await requestId(app, "expiring");
  await Bun.sleep(30);
  expect(SessionState.disposed).toContain(first);
  expect(await requestId(app, "expiring")).not.toBe(first);
  await app.stop();
});

test("a stale expiry timer never disposes a session container mid-request", async () => {
  SessionState.nextId = 0;
  SessionState.disposed = [];
  const app = sessionApp(20);

  let release!: () => void;
  let markEntered!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const entered = new Promise<void>((r) => {
    markEntered = r;
  });
  app.get("/hold", { state: SessionState }, async (_req, { state }) => {
    markEntered();
    await gate;
    return state.id;
  });

  // First request opens the session and arms the 20ms expiry timer on release.
  const first = await requestId(app, "s1");
  await Bun.sleep(10);

  // The second request re-enters and holds the session open past the deadline.
  const holdP = app.dispatch(new Request("http://x/hold", { headers: { "x-session": "s1" } }));
  await entered;
  await Bun.sleep(30);
  // A timer firing in this window must re-arm, not dispose the live container.
  expect(SessionState.disposed.length).toBe(0);

  release();
  const holdRes = await holdP;
  expect(holdRes.status).toBe(200);
  // The in-flight request still saw the original session-scoped instance.
  expect(await holdRes.json()).toBe(first);

  // Once idle again, the timer expires the container for real.
  await Bun.sleep(40);
  expect(SessionState.disposed).toContain(first);
  await app.stop();
});
