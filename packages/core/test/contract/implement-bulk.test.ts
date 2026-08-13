import "reflect-metadata";
import { expect, expectTypeOf, test } from "bun:test";
import { zc } from "@zebra/contract";
import { z } from "zod";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";
import { token } from "../../src/di/token.ts";

class Greeter {
  greet(name: string): string {
    return `hi ${name}`;
  }
}

const router = {
  hello: zc.get("/hello/:name").output(z.string()),
  nested: {
    bye: zc.delete("/bye/:name").status(204),
  },
};

test("bulk implement with shared deps: handlers receive ResolvedDeps", async () => {
  const app = new Zebra({ container: new Container() });
  app.injectSingleton(Greeter);
  app.implement(
    router,
    { g: Greeter },
    {
      hello: (req, { g }) => g.greet(req.params.name),
      nested: {
        bye: (_req, { g }) => {
          expectTypeOf(g).toEqualTypeOf<Greeter>();
          return undefined;
        },
      },
    },
  );

  const res = await app.dispatch(new Request("http://x/hello/world"));
  expect(res.status).toBe(200);
  expect(await res.json()).toBe("hi world");

  const del = await app.dispatch(new Request("http://x/bye/there", { method: "DELETE" }));
  expect(del.status).toBe(204);
});

test("bulk implement without deps", async () => {
  const app = new Zebra({ container: new Container() });
  app.implement(router, {
    hello: (req) => req.params.name,
    nested: { bye: () => undefined },
  });
  const res = await app.dispatch(new Request("http://x/hello/anon"));
  expect(await res.json()).toBe("anon");
});

test("entry can be { handler, middlewares }", async () => {
  const app = new Zebra({ container: new Container() });
  let ran = 0;
  app.implement(router, {
    hello: {
      handler: (req) => req.params.name,
      middlewares: [
        async (_req, next) => {
          ran++;
          return next();
        },
      ],
    },
    nested: { bye: () => undefined },
  });
  await app.dispatch(new Request("http://x/hello/m"));
  expect(ran).toBe(1);
});

test("opts.middlewares apply per implementation", async () => {
  const app = new Zebra({ container: new Container() });
  let ran = 0;
  app.implement(
    router,
    { g: Greeter },
    {
      hello: (req, { g }) => g.greet(req.params.name),
      nested: { bye: () => undefined },
    },
    {
      middlewares: [
        async (_req, next) => {
          ran++;
          return next();
        },
      ],
    },
  );
  await app.dispatch(new Request("http://x/hello/w"));
  await app.dispatch(new Request("http://x/bye/w", { method: "DELETE" }));
  expect(ran).toBe(2);
});

test("missing implementation throws at call time listing dotted keys + method/path", () => {
  const app = new Zebra({ container: new Container() });
  expect(() =>
    // @ts-expect-error nested.bye has no implementation
    app.implement(router, {
      hello: (req) => req.params.name,
      nested: {},
    }),
  ).toThrow(/missing: nested\.bye \(DELETE \/bye\/:name\)/);
});

test("extra implementation keys throw at call time", () => {
  const app = new Zebra({ container: new Container() });
  expect(() =>
    // @ts-expect-error ghost/stray are not in the router
    app.implement(router, {
      hello: (req) => req.params.name,
      nested: {
        bye: () => undefined,
        ghost: () => "nope",
      },
      stray: () => "nope",
    }),
  ).toThrow(/extra: nested\.ghost; extra: stray/);
});

test("missing nested router impl throws with dotted key", () => {
  const app = new Zebra({ container: new Container() });
  expect(() =>
    // @ts-expect-error nested router has no implementation
    app.implement(router, {
      hello: (req) => req.params.name,
    }),
  ).toThrow(/missing: nested/);
});

test("bulk registers routes visible to the radix router (dispatch reaches them)", async () => {
  const app = new Zebra({ container: new Container() });
  app.implement(router, {
    hello: (req) => req.params.name,
    nested: { bye: () => undefined },
  });
  const res = await app.dispatch(new Request("http://x/hello/typed"));
  expect(await res.json()).toBe("typed");
});
