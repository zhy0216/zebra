import "reflect-metadata";
import { expectTypeOf, test } from "bun:test";
import { type StandardSchemaV1, zc } from "@zebra-web/contract";
import { z } from "zod";
import { Zebra } from "../../src/app/app.ts";

const minString: StandardSchemaV1<string, string> = {
  "~standard": {
    version: 1,
    vendor: "hand",
    validate: (value) =>
      typeof value === "string" ? { value } : { issues: [{ message: "not a string" }] },
    types: { input: "" as string, output: "" as string },
  },
};

test("single implement without deps: params/query/body/output typed from contract", () => {
  const app = new Zebra();
  const proc = zc
    .get("/blogs/:id")
    .params(z.object({ id: z.coerce.number().int() }))
    .query(z.object({ verbose: z.coerce.boolean().default(false) }))
    .output(z.object({ id: z.number(), title: z.string() }));

  app.implement(proc, (req) => {
    expectTypeOf(req.params).toEqualTypeOf<{ id: number }>();
    expectTypeOf(req.query).toEqualTypeOf<{ verbose: boolean }>();
    return { id: req.params.id, title: "x" };
  });
});

test("single implement with deps: ResolvedDeps flows to handler", () => {
  const app = new Zebra();
  class Svc {
    hello(): string {
      return "hi";
    }
  }
  app.injectSingleton(Svc);
  app.implement(zc.get("/x").output(z.string()), { svc: Svc }, (req, { svc }) => {
    expectTypeOf(svc).toEqualTypeOf<Svc>();
    expectTypeOf(req.params).toEqualTypeOf<Record<never, string>>();
    return svc.hello();
  });
});

test("hand-written minimal ~standard schema flows through implement", () => {
  const app = new Zebra();
  const proc = zc.get("/p").params(minString).output(minString);
  app.implement(proc, (req) => {
    expectTypeOf(req.params).toEqualTypeOf<string>();
    return req.params;
  });
});

test("body is typed via InferOutput and is async", () => {
  const app = new Zebra();
  const create = zc
    .post("/blogs")
    .body(z.object({ title: z.string().min(1) }))
    .output(z.object({ id: z.number() }));
  app.implement(create, (req) => {
    expectTypeOf(req.params).toEqualTypeOf<Record<never, string>>();
    void req.body().then((b) => expectTypeOf(b).toEqualTypeOf<{ title: string }>());
    return { id: 1 };
  });
});

test("transform: handler returns output InferInput, client-facing output is InferOutput", () => {
  const app = new Zebra();
  const dateProc = zc
    .get("/when")
    .output(z.object({ at: z.string().transform((s) => new Date(s)) }));
  app.implement(dateProc, (_req) => {
    return { at: "2026-01-01T00:00:00Z" };
  });
});

test("handler may return a raw Response as an escape hatch", () => {
  const app = new Zebra();
  app.implement(zc.get("/raw").output(z.string()), () => new Response("raw", { status: 200 }));
});

test("bulk implement: shared deps context derives handler deps and nested routers type-check", () => {
  const app = new Zebra();
  class Repo {
    find(): string {
      return "x";
    }
  }
  app.injectSingleton(Repo);
  const router = {
    list: zc.get("/items").output(z.array(z.string())),
    nested: { get: zc.get("/items/:id").output(z.string()) },
  };
  app.implement(
    router,
    { repo: Repo },
    {
      list: (req, { repo }) => {
        expectTypeOf(repo).toEqualTypeOf<Repo>();
        expectTypeOf(req.query).toEqualTypeOf<Record<string, string>>();
        return [repo.find()];
      },
      nested: {
        get: (req, { repo }) => {
          expectTypeOf(req.params).toEqualTypeOf<{ id: string }>();
          return repo.find();
        },
      },
    },
  );
});

test("bulk implement: missing key is a compile error", () => {
  const app = new Zebra();
  const router = {
    a: zc.get("/a"),
    b: zc.get("/b"),
  };
  try {
    // @ts-expect-error missing implementation for b
    app.implement(router, { a: () => "ok" });
  } catch {
    // expected runtime throw
  }
});

test("bulk implement: wrong handler param type is a compile error", () => {
  const app = new Zebra();
  const router = {
    get: zc.get("/items/:id").params(z.object({ id: z.coerce.number() })),
  };
  // @ts-expect-error req.params.id is a number after coerce, not a string
  app.implement(router, { get: (req) => req.params.id.toUpperCase() });
});

test("bulk implement: wrong deps type is a compile error", () => {
  const app = new Zebra();
  class Repo {
    tag = "repo" as const;
  }
  class Other {
    tag = "other" as const;
  }
  const router = { list: zc.get("/x") };
  // @ts-expect-error deps spec does not include Other
  app.implement(router, { repo: Repo }, { list: (_req, { repo: _repo }: { repo: Other }) => "ok" });
});
