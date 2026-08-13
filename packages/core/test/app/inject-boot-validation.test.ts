import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";
import { injectable } from "../../src/di/decorators.ts";
import {
  CircularDependencyError,
  ScopeMismatchError,
  UnboundTokenError,
} from "../../src/di/errors.ts";
import { token } from "../../src/di/token.ts";

test("listen: declared-form factory with unbound dep throws UnboundTokenError at boot", async () => {
  const Missing = token<string>("Missing");
  const Out = token<string>("Out");
  const c = new Container();
  c.bind(Out).toFactoryWithDeps({ m: Missing }, ({ m }) => m as string);

  const app = new Zebra({ container: c });
  app.get("/x", { out: Out }, async () => "ok");
  await expect(app.listen({ port: 0 })).rejects.toThrow(UnboundTokenError);
});

test("listen: declared-form factory with circular dep throws CircularDependencyError at boot", async () => {
  const A = token<unknown>("FacA");
  const B = token<unknown>("FacB");
  const c = new Container();
  c.bind(A).toFactoryWithDeps({ b: B }, ({ b }) => ({ b }));
  c.bind(B).toFactoryWithDeps({ a: A }, ({ a }) => ({ a }));

  const app = new Zebra({ container: c });
  app.get("/x", { a: A }, async () => "ok");
  await expect(app.listen({ port: 0 })).rejects.toThrow(CircularDependencyError);
});

@injectable()
class ReqOnly {}

test("listen: singleton factory depending on request-scoped class throws ScopeMismatchError", async () => {
  const SingletonOut = token<unknown>("SingletonOut");
  const c = new Container();
  c.bind(ReqOnly).toSelf().inRequestScope();
  c.bind(SingletonOut).toFactoryWithDeps({ r: ReqOnly }, ({ r }) => ({ r }));
  // SingletonOut defaults to singleton scope (Binding default)

  const app = new Zebra({ container: c });
  app.get("/x", { s: SingletonOut }, async () => "ok");
  await expect(app.listen({ port: 0 })).rejects.toThrow(ScopeMismatchError);
});

test("listen: lazy-form factory (no factoryDeps) still NOT validated at boot — regression guard", async () => {
  const Missing = token<string>("Missing");
  const Out = token<string>("Out");
  const c = new Container();
  // Lazy form — even though it'd fail at resolve time, boot validation must not walk into it
  c.bind(Out).toFactory((ctr) => ctr.resolve(Missing));

  const app = new Zebra({ container: c });
  app.get("/x", { out: Out }, async () => "ok");
  // Must NOT throw at listen time — only at first request
  const result = await app.listen({ port: 0 });
  expect(result.port).toBeGreaterThan(0);
  await app.stop();
});
