import "reflect-metadata";
import { test, expect } from "bun:test";
import { Container } from "../../src/di/container.ts";
import { injectable } from "../../src/di/decorators.ts";
import { ScopeKind } from "../../src/di/scope.ts";
import type { Disposable } from "../../src/di/disposable.ts";

@injectable()
class SessionState implements Disposable {
  static disposed = 0;
  static created = 0;
  readonly id = ++SessionState.created;
  dispose() { SessionState.disposed++; }
}

test("session scope behaves like request: cached within child", () => {
  SessionState.created = 0;
  SessionState.disposed = 0;
  const root = new Container();
  root.bind(SessionState).toSelf().inSessionScope();

  const session = root.createChildScope(ScopeKind.Session);
  const a = session.resolve(SessionState);
  const b = session.resolve(SessionState);
  expect(a).toBe(b);
});

test("dispose() on child scope runs Disposable.dispose() on cached instances", async () => {
  SessionState.created = 0;
  SessionState.disposed = 0;
  const root = new Container();
  root.bind(SessionState).toSelf().inSessionScope();

  const session = root.createChildScope(ScopeKind.Session);
  session.resolve(SessionState);
  await session.dispose();
  expect(SessionState.disposed).toBe(1);
});
