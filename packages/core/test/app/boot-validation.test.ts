import "reflect-metadata";
import { test, expect } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";
import { injectable, inject } from "../../src/di/decorators.ts";
import { token } from "../../src/di/token.ts";
import {
  UnboundTokenError,
  ScopeMismatchError,
  CircularDependencyError,
} from "../../src/di/errors.ts";

@injectable() class Db {}
@injectable() class Repo { constructor(public db: Db) {} }
@injectable() class Svc { constructor(public repo: Repo) {} }

test("listen fails with UnboundTokenError when a route dep is not bound", async () => {
  const c = new Container();
  // forgot to bind Db
  c.bind(Repo).toSelf();
  c.bind(Svc).toSelf();
  const app = new Zebra({ container: c });
  app.get("/x", { svc: Svc }, async () => "ok");
  await expect(app.listen({ port: 0 })).rejects.toThrow(UnboundTokenError);
});

@injectable() class ReqDep {}
@injectable() class SingletonWithRequest { constructor(public r: ReqDep) {} }

test("listen fails with ScopeMismatchError: singleton depends on request", async () => {
  const c = new Container();
  c.bind(ReqDep).toSelf().inRequestScope();
  c.bind(SingletonWithRequest).toSelf();
  const app = new Zebra({ container: c });
  app.get("/x", { s: SingletonWithRequest }, async () => "ok");
  await expect(app.listen({ port: 0 })).rejects.toThrow(ScopeMismatchError);
});

const CycAToken = token<any>("CycA");
const CycBToken = token<any>("CycB");

@injectable() class CycA {
  constructor(@inject(CycBToken) public b: unknown) {}
}
@injectable() class CycB {
  constructor(@inject(CycAToken) public a: unknown) {}
}

test("listen fails with CircularDependencyError", async () => {
  const c = new Container();
  c.bind(CycAToken).to(CycA);
  c.bind(CycBToken).to(CycB);
  const app = new Zebra({ container: c });
  app.get("/x", { a: CycAToken }, async () => "ok");
  await expect(app.listen({ port: 0 })).rejects.toThrow(CircularDependencyError);
});
