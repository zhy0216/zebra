import { expectTypeOf, test } from "bun:test";
import { z } from "zod";
import { zc } from "../src/index.ts";
import type { InferBody, InferOutput, InferParams, InferQuery } from "../src/types.ts";

const Blog = z.object({ id: z.number(), title: z.string(), content: z.string() });

test("builder chain preserves literals and accumulates schema types", () => {
  const proc = zc
    .get("/blogs/:id")
    .params(z.object({ id: z.coerce.number().int() }))
    .query(z.object({ verbose: z.boolean().default(false) }))
    .output(Blog)
    .status(201)
    .meta({ summary: "Get blog" })
    .errors({ blog_not_found: { status: 404 } });

  expectTypeOf(proc.def.method).toEqualTypeOf<"GET">();
  expectTypeOf(proc.def.path).toEqualTypeOf<"/blogs/:id">();
  expectTypeOf(proc.def.status).toEqualTypeOf<201>();
  expectTypeOf(proc.def.errors).toEqualTypeOf<{ readonly blog_not_found: { readonly status: 404 } }>();
  expectTypeOf(proc.def.meta).toEqualTypeOf<{ readonly summary: "Get blog" }>();
  expectTypeOf(proc.def.body).toEqualTypeOf<undefined>();

  expectTypeOf<InferParams<typeof proc>>().toEqualTypeOf<{ id: number }>();
  expectTypeOf<InferQuery<typeof proc>>().toEqualTypeOf<{ verbose: boolean }>();
  expectTypeOf<InferBody<typeof proc>>().toEqualTypeOf<unknown>();
  expectTypeOf<InferOutput<typeof proc>>().toEqualTypeOf<{
    id: number;
    title: string;
    content: string;
  }>();
});

test("bare zc.get is a valid procedure with fallback types", () => {
  const bare = zc.get("/blogs");
  expectTypeOf(bare.def.method).toEqualTypeOf<"GET">();
  expectTypeOf(bare.def.path).toEqualTypeOf<"/blogs">();
  expectTypeOf(bare.def.status).toEqualTypeOf<200>();
  expectTypeOf<InferParams<typeof bare>>().toEqualTypeOf<Record<never, string>>();
  expectTypeOf<InferQuery<typeof bare>>().toEqualTypeOf<Record<string, string>>();
  expectTypeOf<InferBody<typeof bare>>().toEqualTypeOf<unknown>();
  expectTypeOf<InferOutput<typeof bare>>().toEqualTypeOf<unknown>();
});

test("POST body schema flows InferOutput", () => {
  const create = zc.post("/blogs").body(z.object({ title: z.string() })).output(Blog);
  expectTypeOf(create.def.method).toEqualTypeOf<"POST">();
  expectTypeOf<InferBody<typeof create>>().toEqualTypeOf<{ title: string }>();
  expectTypeOf<InferOutput<typeof create>>().toEqualTypeOf<{
    id: number;
    title: string;
    content: string;
  }>();
});

test("GET .body() is a compile error", () => {
  try {
    // @ts-expect-error body is not allowed on GET procedures
    const bad = zc.get("/x").body(z.object({}));
    void bad;
  } catch {
    // runtime fallback throw expected
  }
});

test("errors accumulate across calls", () => {
  const p = zc
    .get("/a")
    .errors({ one: { status: 400 } })
    .errors({ two: { status: 404 } });
  expectTypeOf(p.def.errors).branded.toEqualTypeOf<{ readonly one: { readonly status: 400 }; readonly two: { readonly status: 404 } }>();
});

test("chain is immutable: later calls do not mutate earlier procedures", () => {
  const bare = zc.get("/blogs/:id");
  const withParams = bare.params(z.object({ id: z.string() }));
  const withOutput = bare.output(Blog);
  expectTypeOf(bare.def.params).toEqualTypeOf<undefined>();
  expectTypeOf(withParams.def.path).toEqualTypeOf<"/blogs/:id">();
  expectTypeOf(withParams.def.output).toEqualTypeOf<undefined>();
  expectTypeOf(withOutput.def.params).toEqualTypeOf<undefined>();
  expectTypeOf(withOutput.def.output).toEqualTypeOf<typeof Blog>();
});
