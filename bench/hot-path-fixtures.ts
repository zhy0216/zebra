import { join } from "node:path";
import type { Source } from "./hot-path-source.ts";
import { JSON_PAYLOAD, MIDDLEWARE_LAYERS, SCENARIOS, type Scenario } from "./scenarios.ts";

export const SUITES = ["router", "request", "di", "dispatch", "http"] as const;
export type Suite = (typeof SUITES)[number];

interface OperationBase {
  name: string;
  divisor?: number;
  unit?: "table";
  routes?: number;
  before?: (count: number) => void;
  after?: () => void;
}
export type Operation = OperationBase &
  (
    | { kind: "sync"; run: (index: number) => number }
    | { kind: "async"; run: (index: number) => Promise<number> }
  );
export interface HttpFixture {
  name: string;
  url: string;
  scenario: Scenario;
}
export interface Fixtures {
  operations: Operation[];
  http: HttpFixture[];
  controls: string[];
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Hot-path workload mismatch: ${message}`);
}

export async function consumeResponse(response: Response, scenario: Scenario): Promise<number> {
  try {
    const body = await response.text();
    invariant(
      response.status === 200 && scenario.verify(body),
      `${scenario.name}: status=${response.status}, body=${JSON.stringify(body.slice(0, 120))}`,
    );
    return body.length;
  } finally {
    if (response.body && !response.bodyUsed && !response.body.locked) await response.body.cancel();
  }
}

export function fetchInit(scenario: Scenario): RequestInit {
  return scenario.method === "POST"
    ? { method: "POST", headers: { "content-type": "application/json" }, body: scenario.body }
    : {};
}

function routerFixtures({ Router }: Source, fixtures: Fixtures) {
  for (const count of [10, 100, 1000]) {
    const entries: Array<[string, string, number]> = Array.from({ length: count - 4 }, (_, i) => [
      "GET",
      `/r${i}`,
      i + 1,
    ]);
    entries.push(
      ["GET", "/deep/a/b/c/d/e", 1001],
      ["GET", "/param/:id", 1002],
      ["GET", "/wild/*tail", 1003],
      ["POST", "/post", 1004],
    );
    const create = () => {
      const router = new Router<number>();
      for (const [method, path, value] of entries) router.add(method, path, value);
      return router;
    };
    const router = create();
    const cases: Array<[string, string, string, number | null, string?, string?]> = [
      ["static-shallow", "GET", "/r3", 4],
      ["static-deep", "GET", "/deep/a/b/c/d/e", 1001],
      ["param", "GET", "/param/42", 1002, "id", "42"],
      ["param-encoded", "GET", "/param/a%2Fb", 1002, "id", "a/b"],
      ["wildcard", "GET", "/wild/a/b%2Fc", 1003, "tail", "a/b%2Fc"],
      ["miss", "GET", "/missing", null],
      ["method-miss", "PUT", "/r3", null],
    ];
    for (const [name, method, path, expected, key, value] of cases) {
      fixtures.operations.push({
        kind: "sync",
        name: `${count}/${name}`,
        run: () => {
          const match = router.find(method, path);
          invariant((match?.handler ?? null) === expected, `router ${count}/${name} handler`);
          if (key) invariant(match?.params[key] === value, `router ${name} capture`);
          return (match?.handler ?? 1) + (key ? match!.params[key]!.length : 0);
        },
      });
    }
    fixtures.operations.push({
      kind: "sync",
      name: `${count}/registration`,
      unit: "table",
      routes: count,
      divisor: 1000,
      run: () => {
        const built = create();
        invariant(built.find("GET", "/r3")?.handler === 4, "registered table lookup");
        return count;
      },
    });
  }
  const router = new Router<number>();
  router.add("GET", "/item/fixed", 1);
  router.add("POST", "/item/:id", 2);
  router.add("DELETE", "/item/*tail", 3);
  invariant(router.find("get", "///item/fixed///")?.handler === 1, "static precedence/slashes");
  invariant(router.find("POST", "/item/fixed")?.params.id === "fixed", "method backtracking");
  invariant(router.find("DELETE", "/item/fixed")?.handler === 3, "wildcard method fallback");
  invariant(router.allowedMethods("/item/fixed")?.join(",") === "GET,POST,DELETE", "method union");
  invariant(router.find("POST", "/item/%GG")?.params.id === "%GG", "malformed escape");
  invariant(router.find("DELETE", "/item")?.params.tail === "", "empty wildcard");
  fixtures.controls.push(
    "router: precedence, method fallback/union, slashes, malformed/encoded captures",
  );
}

async function requestFixtures({ buildRequest }: Source, fixtures: Fixtures) {
  const address = "http://127.0.0.1/item?x=first&x=last&__proto__=safe";
  for (const supplied of [true, false]) {
    let raw: Request[] = [];
    let urls: URL[] = [];
    let params: Array<{ id: string }> = [];
    fixtures.operations.push({
      kind: "sync",
      name: supplied ? "constructor-supplied-url" : "constructor-parse-url",
      divisor: 5,
      before: (count) => {
        raw = Array.from({ length: count }, () => new Request(address));
        urls = supplied ? Array.from({ length: count }, () => new URL(address)) : [];
        params = Array.from({ length: count }, () => ({ id: "42" }));
      },
      run: (i) => {
        const req = buildRequest(raw[i]!, params[i]!, undefined, undefined, undefined, urls[i]);
        invariant(req.raw === raw[i] && req.params === params[i], "constructor identity");
        return req.params.id.length;
      },
      after: () => {
        raw = [];
        urls = [];
        params = [];
      },
    });
  }
  const key = Symbol("metadata");
  fixtures.operations.push({
    kind: "sync",
    name: "metadata",
    divisor: 5,
    run: () => {
      const raw = new Request(address);
      let calls = 0;
      const req = buildRequest(raw, {}, undefined, undefined, undefined, undefined, () => {
        calls++;
        return "127.0.0.1";
      });
      const ctx = req.ctx;
      ctx.set(key, 7);
      invariant(
        req.headers === raw.headers && req.signal === raw.signal,
        "headers/signal identity",
      );
      invariant(req.ip === "127.0.0.1" && req.ip === "127.0.0.1" && calls === 1, "memoized IP");
      invariant(
        req.query.x === "last" && Object.getPrototypeOf(req.query) === null,
        "query semantics",
      );
      invariant(req.ctx === ctx && req.ctx.get(key) === 7, "context identity");
      return req.query.x.length + req.ip.length + Number(req.ctx.get(key));
    },
  });
  const payload = JSON.stringify(JSON_PAYLOAD);
  for (const shared of [false, true]) {
    fixtures.operations.push({
      kind: "async",
      name: shared ? "body-shared" : "body-json",
      divisor: 30,
      run: async () => {
        const req = buildRequest(
          new Request(address, {
            method: "POST",
            headers: { "content-type": "Application/JSON" },
            body: payload,
          }),
          {},
        );
        const value = await req.json();
        invariant(JSON.stringify(value) === payload, "JSON body output");
        if (shared) {
          invariant((await req.json()) === value, "JSON result identity");
          invariant((await req.text()) === payload, "shared body text");
          invariant(JSON.stringify(await req.body()) === payload, "shared parsed body");
        }
        return payload.length;
      },
    });
  }
  const raw = new Request(address, {
    method: "POST",
    headers: { "content-type": "Application/JSON" },
    body: payload,
  });
  const controller = new AbortController();
  const url = new URL(address);
  const req = buildRequest(raw, {}, undefined, "peer", controller.signal, url);
  raw.headers.set("content-type", "text/plain");
  invariant(JSON.stringify(await req.body()) === payload, "content-type snapshot");
  invariant(
    req.url === url && req.signal === controller.signal && req.ip === "peer",
    "supplied metadata",
  );
  controller.abort("probe");
  invariant(req.signal.aborted && req.signal.reason === "probe", "abort delivery");
  const query = { replacement: "ok" };
  req.query = query;
  invariant(req.query === query, "query replacement");
  fixtures.controls.push(
    "request: fresh raw/params, supplied metadata, header snapshot, abort, shared body identity",
  );
}

function diFixtures(source: Source, fixtures: Fixtures, close: Array<() => Promise<void>>) {
  const { Container, token, ScopeKind, injectable } = source;
  const root = new Container();
  close.push(() => root.dispose());
  let constructed = 0;
  class Service {
    value = 7;
    constructor() {
      constructed++;
    }
  }
  injectable()(Service);
  const value = { value: 7 };
  const valueToken = token<typeof value>("hot.value");
  const factoryToken = token<typeof value>("hot.factory");
  let factories = 0;
  root.bind(valueToken).toValue(value);
  root.bind(Service).toSelf();
  root.bind(factoryToken).toFactory(() => {
    factories++;
    return { value: 7 };
  });
  const requestToken = token<Service>("hot.request");
  const sessionToken = token<Service>("hot.session");
  root.bind(requestToken).to(Service).inRequestScope();
  root.bind(sessionToken).to(Service).inSessionScope();
  const session = root.createChildScope(ScopeKind.Session);
  const request = session.createChildScope(ScopeKind.Request);
  close.push(
    () => session.dispose(),
    () => request.dispose(),
  );
  for (const [name, container, id] of [
    ["value", root, valueToken],
    ["singleton-class-warm", root, Service],
    ["singleton-factory-warm", root, factoryToken],
    ["request-warm", request, requestToken],
    ["session-warm", request, sessionToken],
  ] as const) {
    const expected = container.resolve(id);
    fixtures.operations.push({
      kind: "sync",
      name,
      run: () => {
        const result = container.resolve(id);
        invariant(result === expected, `${name} cached identity`);
        return result.value;
      },
    });
  }
  // Count baselines must be captured per batch, after the other fixtures have warmed.
  for (const operation of fixtures.operations) {
    let constructorsBefore = 0;
    let factoriesBefore = 0;
    operation.before = () => {
      constructorsBefore = constructed;
      factoriesBefore = factories;
    };
    operation.after = () =>
      invariant(
        constructed === constructorsBefore && factories === factoriesBefore,
        `${operation.name} invocation counts`,
      );
  }
  for (const factory of [false, true]) {
    fixtures.operations.push({
      kind: "sync",
      name: factory ? "factory-cold-bind-resolve" : "class-cold-bind-resolve",
      divisor: 5,
      run: () => {
        const container = new Container();
        let calls = 0;
        if (factory)
          container.bind(factoryToken).toFactory(() => {
            calls++;
            return { value: 7 };
          });
        else container.bind(Service).toSelf();
        const before = constructed;
        const result = factory ? container.resolve(factoryToken) : container.resolve(Service);
        invariant(factory ? calls === 1 : constructed === before + 1, "cold invocation count");
        return result.value;
      },
    });
  }
  const transient = token<Service>("hot.transient");
  root.bind(transient).to(Service).inTransientScope();
  const chain = token<typeof value>("hot.chain");
  const middle = token<typeof value>("hot.middle");
  root
    .bind(middle)
    .toFactoryWithDeps({ leaf: transient }, (deps) => ({ value: (deps.leaf as Service).value }))
    .inTransientScope();
  root
    .bind(chain)
    .toFactoryWithDeps({ middle }, (deps) => ({ value: (deps.middle as typeof value).value }))
    .inTransientScope();
  for (const [name, id] of [
    ["transient-class", transient],
    ["transient-chain-3", chain],
  ] as const) {
    let previous: unknown;
    fixtures.operations.push({
      kind: "sync",
      name,
      run: () => {
        const before = constructed;
        const result = root.resolve(id);
        invariant(
          result !== previous && constructed === before + 1,
          `${name} fresh identity/count`,
        );
        previous = result;
        return result.value;
      },
    });
  }
  const sibling = session.createChildScope(ScopeKind.Request);
  close.push(() => sibling.dispose());
  invariant(
    sibling.resolve(requestToken) !== request.resolve(requestToken),
    "request scope ownership",
  );
  invariant(
    sibling.resolve(sessionToken) === request.resolve(sessionToken),
    "nearest session scope ownership",
  );
  for (const falsy of [undefined, null, false, 0]) {
    const id = token<unknown>("falsy");
    let calls = 0;
    root.bind(id).toFactory(() => {
      calls++;
      return falsy;
    });
    invariant(
      root.resolve(id) === falsy && root.resolve(id) === falsy && calls === 1,
      "falsy cache hit",
    );
  }
  fixtures.controls.push(
    "DI: identity/counts, falsy cache hits, nearest request/session ownership; cold rows include binding",
  );
}

async function appFixtures(
  source: Source,
  fixtures: Fixtures,
  close: Array<() => Promise<void>>,
  suite: "http" | "dispatch",
) {
  const { Zebra, Container, token, injectable, HttpError } = source;
  for (const listeners of [false, true]) {
    const container = new Container();
    const app = new Zebra({ container, gracePeriod: 100 });
    close.push(() => app.stop());
    let classCalls = 0;
    let factoryCalls = 0;
    class Service {
      value = "ok";
      constructor() {
        classCalls++;
      }
    }
    injectable()(Service);
    const factory = token<Service>("app.factory");
    app.injectSingleton(Service);
    app.injectFactorySingleton(factory, () => {
      factoryCalls++;
      return { value: "ok" };
    });
    const classValue = container.resolve(Service);
    const factoryValue = container.resolve(factory);
    const di = token<{ ok: string }>("app.value");
    app.injectValue(di, { ok: "ok" });
    const plain = (body: string) =>
      new Response(body, { headers: { "content-type": "text/plain" } });
    app.get("/hello", () => plain("hello world"));
    app.get("/user/:id", (req) => plain(req.params.id));
    app.get("/wild/*tail", (req) => plain(req.params.tail));
    app.get("/json", () => JSON_PAYLOAD);
    app.post("/post-json", async (req) => req.json());
    app.get("/di", { di }, (_req, deps) => ({ di: deps.di.ok }));
    app.static("/static", join(import.meta.dir, "fixtures/static"), { maxAge: 60 });
    for (const depth of [MIDDLEWARE_LAYERS, 20]) {
      app.group("", (group) => {
        for (let i = 0; i < depth; i++) group.use(async (_req, next) => next());
        group.get(depth === 5 ? "/middleware" : "/middleware-20", () => plain("middleware ok"));
      });
    }
    app.get("/async", async () => plain("hello world"));
    app.get("/query", (req) => plain(req.query.name ?? "missing"));
    const metadataKey = Symbol("http.metadata");
    app.get("/metadata", (req) => {
      req.ctx.set(metadataKey, "ok");
      invariant(
        req.headers === req.raw.headers && req.signal === req.raw.signal,
        "HTTP metadata identity",
      );
      invariant(suite === "http" ? req.ip === "127.0.0.1" : req.ip === undefined, "HTTP peer IP");
      return plain(`${req.query.name}:${req.ctx.get(metadataKey)}:${req.signal.aborted}`);
    });
    app.get("/class", { service: Service }, (_req, { service }) => {
      invariant(service === classValue && classCalls === 1, "HTTP warmed class identity/count");
      return { di: service.value };
    });
    app.get("/factory", { service: factory }, (_req, { service }) => {
      invariant(
        service === factoryValue && factoryCalls === 1,
        "HTTP warmed factory identity/count",
      );
      return { di: service.value };
    });
    app.get("/error", () => {
      throw new HttpError(418, "probe", "probe error");
    });
    let headCancelled = 0;
    app.get(
      "/head-stream",
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([42]));
            },
            cancel() {
              headCancelled++;
            },
          }),
        ),
    );
    const { port } = await app.listen({ port: 0, hostname: "127.0.0.1" });
    const base = `http://127.0.0.1:${port}`;
    let requests = 0;
    let completions = 0;
    let middlewareBefore = 0;
    let middlewareAfter = 0;
    if (listeners) {
      // Register after listen: a boot-time no-listeners specialization would fail this probe.
      app.on("before.request", () => {
        requests++;
      });
      app.on("after.request", () => {
        completions++;
      });
      app.on("before.middleware", () => {
        middlewareBefore++;
      });
      app.on("after.middleware", () => {
        middlewareAfter++;
      });
    }
    const call = (path: string, init: RequestInit = {}) =>
      suite === "http"
        ? fetch(base + path, { ...init, signal: AbortSignal.timeout(10000) })
        : app.dispatch(new Request(base + path, init));
    for (const [path, method, status] of [
      ["/error", "GET", 418],
      ["/hello", "HEAD", 200],
      ["/hello", "OPTIONS", 204],
      ["/hello", "PUT", 405],
      ["/absent", "GET", 404],
      ["/head-stream", "HEAD", 200],
    ] as const) {
      const response = await call(path, { method });
      const body = await response.text();
      invariant(response.status === status, `${suite} ${method} ${path} status`);
      if (method === "HEAD" || status === 204) invariant(body === "", `${method} empty body`);
      if (status >= 400) invariant(JSON.parse(body).status === status, "Problem+Json status");
      if (status === 204 || status === 405)
        invariant(response.headers.get("allow") === "GET, HEAD", "Allow methods");
    }
    invariant(headCancelled === 1, "HEAD stream cancellation");
    const additions: Scenario[] = [
      { name: "async", path: "/async", verify: (body) => body === "hello world" },
      { name: "query", path: "/query?name=zebra", verify: (body) => body === "zebra" },
      {
        name: "metadata",
        path: "/metadata?name=zebra",
        verify: (body) => body === "zebra:ok:false",
      },
      { name: "class-warm", path: "/class", verify: (body) => body === '{"di":"ok"}' },
      { name: "factory-warm", path: "/factory", verify: (body) => body === '{"di":"ok"}' },
      { name: "middleware-20", path: "/middleware-20", verify: (body) => body === "middleware ok" },
    ];
    const scenarios = listeners
      ? [SCENARIOS[0]!, SCENARIOS[3]!].map((scenario) => ({
          ...scenario,
          name: `${scenario.name}-listeners`,
        }))
      : suite === "http"
        ? [...SCENARIOS, ...additions]
        : [SCENARIOS[0]!, SCENARIOS[3]!, ...additions];
    for (const scenario of scenarios) {
      await consumeResponse(await call(scenario.path, fetchInit(scenario)), scenario);
      if (suite === "http")
        fixtures.http.push({ name: scenario.name, url: base + scenario.path, scenario });
      else
        fixtures.operations.push({
          kind: "async",
          name: scenario.name,
          divisor: 30,
          run: async () =>
            consumeResponse(await call(scenario.path, fetchInit(scenario)), scenario),
        });
    }
    if (listeners)
      invariant(
        requests > 0 &&
          completions > 0 &&
          middlewareBefore === middlewareAfter &&
          middlewareBefore > 0,
        "live listener delivery",
      );
  }
  fixtures.controls.push(
    `${suite}: booted apps, original response semantics, warmed DI, late listeners, error/HEAD/OPTIONS/405/404, HEAD cancellation`,
  );
}

export async function withFixtures<T>(
  source: Source,
  suite: Suite,
  work: (fixtures: Fixtures) => Promise<T>,
): Promise<T> {
  const close: Array<() => Promise<void>> = [];
  const fixtures: Fixtures = { operations: [], http: [], controls: [] };
  const errors: unknown[] = [];
  let result: T | undefined;
  try {
    if (suite === "router") routerFixtures(source, fixtures);
    else if (suite === "request") await requestFixtures(source, fixtures);
    else if (suite === "di") diFixtures(source, fixtures, close);
    else await appFixtures(source, fixtures, close, suite);
    result = await work(fixtures);
  } catch (error) {
    errors.push(error);
  } finally {
    for (const dispose of close.reverse()) {
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Hot-path workload/cleanup failed");
  return result as T;
}
