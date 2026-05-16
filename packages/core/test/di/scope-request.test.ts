import "reflect-metadata";
import { expect, test } from "bun:test";
import { Container } from "../../src/di/container.ts";
import { injectable } from "../../src/di/decorators.ts";
import { ScopeKind } from "../../src/di/scope.ts";

@injectable()
class Req {
  static n = 0;
  readonly id = ++Req.n;
}

test("request scope: same instance within child, new on different children", () => {
  Req.n = 0;
  const root = new Container();
  root.bind(Req).toSelf().inRequestScope();

  const child1 = root.createChildScope(ScopeKind.Request);
  expect(child1.resolve(Req).id).toBe(1);
  expect(child1.resolve(Req).id).toBe(1);

  const child2 = root.createChildScope(ScopeKind.Request);
  expect(child2.resolve(Req).id).toBe(2);
});

test("singletons resolved from child come from root cache", () => {
  @injectable()
  class Single {
    static n = 0;
    readonly id = ++Single.n;
  }
  const root = new Container();
  root.bind(Single).toSelf();
  const child = root.createChildScope(ScopeKind.Request);
  expect(root.resolve(Single).id).toBe(child.resolve(Single).id);
});
