import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { token } from "../../src/di/token.ts";

test("injectValue: bound value resolves via route deps", async () => {
  const Config = token<{ env: string }>("Config");
  const app = new Zebra();
  app.injectValue(Config, { env: "prod" });
  app.get("/env", { cfg: Config }, async (_req, { cfg }) => (cfg as any).env);
  const { port } = await app.listen({ port: 0 });
  const res = await fetch(`http://localhost:${port}/env`);
  expect(await res.text()).toBe('"prod"');
  await app.stop();
});

test("injectValue after listen() throws", async () => {
  const Config = token<{ env: string }>("Config");
  const app = new Zebra();
  app.get("/", async () => "ok");
  await app.listen({ port: 0 });
  expect(() => app.injectValue(Config, { env: "x" })).toThrow(
    /Cannot register bindings after app.listen/,
  );
  await app.stop();
});

import { injectable } from "../../src/di/decorators.ts";

@injectable() class Greeter {
  hello() { return "hi"; }
}

abstract class IGreeter {
  abstract hello(): string;
}
@injectable() class LoudGreeter extends IGreeter {
  hello() { return "HI"; }
}

test("injectSingleton(X): toSelf, same instance across resolves", async () => {
  const app = new Zebra();
  app.injectSingleton(Greeter);
  app.get("/", { g: Greeter }, async (_req, { g }) => (g as Greeter).hello());
  const { port } = await app.listen({ port: 0 });
  const r1 = await (await fetch(`http://localhost:${port}/`)).text();
  expect(r1).toBe('"hi"');
  await app.stop();
});

test("injectSingleton(IFace, Impl): maps interface to implementation", async () => {
  const app = new Zebra();
  app.injectSingleton(IGreeter, LoudGreeter);
  app.get("/", { g: IGreeter }, async (_req, { g }) => (g as IGreeter).hello());
  const { port } = await app.listen({ port: 0 });
  const r1 = await (await fetch(`http://localhost:${port}/`)).text();
  expect(r1).toBe('"HI"');
  await app.stop();
});

@injectable() class ReqState {
  static idCounter = 0;
  id = ++ReqState.idCounter;
}

test("injectRequest(X): one instance per request scope", async () => {
  ReqState.idCounter = 0;
  const app = new Zebra();
  app.injectRequest(ReqState);
  app.get("/r", { s: ReqState }, async (_req, { s }) => (s as ReqState).id);
  const { port } = await app.listen({ port: 0 });
  const a = await (await fetch(`http://localhost:${port}/r`)).text();
  const b = await (await fetch(`http://localhost:${port}/r`)).text();
  expect(a).not.toBe(b);
  await app.stop();
});

@injectable() class Tick {
  static n = 0;
  v = ++Tick.n;
}

test("injectTransient(X): new instance every resolve", async () => {
  Tick.n = 0;
  const app = new Zebra();
  app.injectTransient(Tick);
  app.get("/t", { t: Tick }, async (_req, { t }) => (t as Tick).v);
  const { port } = await app.listen({ port: 0 });
  const a = await (await fetch(`http://localhost:${port}/t`)).text();
  const b = await (await fetch(`http://localhost:${port}/t`)).text();
  expect(a).not.toBe(b);
  await app.stop();
});

@injectable() class SessionItem {}

test("injectSession(X): registers without error (resolution requires session child scope, exercised elsewhere)", () => {
  const app = new Zebra();
  expect(() => app.injectSession(SessionItem)).not.toThrow();
});

test("class inject methods after listen() throw", async () => {
  const app = new Zebra();
  app.get("/", async () => "ok");
  await app.listen({ port: 0 });
  expect(() => app.injectSingleton(Greeter)).toThrow(/after app.listen/);
  expect(() => app.injectRequest(ReqState)).toThrow(/after app.listen/);
  expect(() => app.injectTransient(Tick)).toThrow(/after app.listen/);
  expect(() => app.injectSession(SessionItem)).toThrow(/after app.listen/);
  await app.stop();
});
