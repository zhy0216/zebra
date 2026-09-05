import { expect, test } from "bun:test";
import { zc } from "@zebra-web/contract";
import { z } from "zod";
import { Zebra } from "../../src/app/app.ts";

test("middleware text and handler json reads preserve the validated contract body", async () => {
  const app = new Zebra();
  let middlewareText = "";
  app.use(async (req, next) => {
    middlewareText = await req.text();
    return next();
  });
  let validations = 0;
  const schema = z.object({ count: z.coerce.number() }).transform((value) => {
    validations++;
    return { ...value, validated: true };
  });
  app.implement(zc.post("/items").body(schema), async (req) => {
    const first = await req.body();
    const rawJson = await req.json();
    expect(await req.body()).toBe(first);
    expect(await req.text()).toEqual(middlewareText);
    return { body: first, rawJson };
  });
  const payload = '{"count":"2","extra":"unvalidated"}';
  const response = await app.dispatch(
    new Request("http://x/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    body: { count: 2, validated: true },
    rawJson: { count: "2", extra: "unvalidated" },
  });
  expect(middlewareText).toBe(payload);
  expect(validations).toBe(1);
});

test("middleware pre-reading text preserves malformed JSON and contract validation errors", async () => {
  const app = new Zebra();
  app.use(async (req, next) => {
    await req.text();
    return next();
  });
  app.implement(zc.post("/items").body(z.object({ count: z.number() })), (req) => req.body());
  for (const [payload, status, code] of [
    ["{invalid", 400, "invalid_json"],
    ['{"count":"no"}', 422, "validation_failed"],
  ] as const) {
    const response = await app.dispatch(
      new Request("http://x/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      }),
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ type: `https://errors.zebra.dev/${code}` });
  }
});
