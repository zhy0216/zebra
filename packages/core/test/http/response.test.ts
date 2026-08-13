import { expect, test } from "bun:test";
import { html, json, redirect, stream, text } from "../../src/http/response.ts";

test("json(undefined) maps to an empty 204 (no invalid JSON body)", async () => {
  const res = json(undefined);
  expect(res.status).toBe(204);
  expect(res.body).toBeNull();
  expect(res.headers.has("content-type")).toBe(false);
});

test("json sets content-type and status defaults", async () => {
  const res = json({ a: 1 });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(await res.json()).toEqual({ a: 1 });
});

test("json honors custom status and content-type override", async () => {
  const res = json(
    { error: "x" },
    { status: 422, headers: { "content-type": "application/problem+json", "x-custom": "1" } },
  );
  expect(res.status).toBe(422);
  expect(res.headers.get("content-type")).toBe("application/problem+json");
  expect(res.headers.get("x-custom")).toBe("1");
  expect(await res.json()).toEqual({ error: "x" });
});

test("json serializes null and strings", async () => {
  expect(await json(null).text()).toBe("null");
  expect(await json("hi").text()).toBe('"hi"');
});

test("text sets text/plain with utf-8", async () => {
  const res = text("hello");
  expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(await res.text()).toBe("hello");
});

test("text honors init status and extra headers", async () => {
  const res = text("hello", { status: 201, headers: { "x-a": "b" } });
  expect(res.status).toBe(201);
  expect(res.headers.get("x-a")).toBe("b");
  expect(await res.text()).toBe("hello");
});

test("html sets text/html with utf-8", async () => {
  const res = html("<p>hi</p>");
  expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(await res.text()).toBe("<p>hi</p>");
});

test("redirect defaults to 302 with Location from string", () => {
  const res = redirect("/login");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/login");
  expect(res.body).toBeNull();
});

test("redirect accepts URL and custom status", () => {
  const res = redirect(new URL("https://example.com/x"), { status: 301 });
  expect(res.status).toBe(301);
  expect(res.headers.get("location")).toBe("https://example.com/x");
});

test("redirect Location always comes from url, init headers merged", () => {
  const res = redirect("/a", { headers: { "x-cache": "no" } });
  expect(res.headers.get("location")).toBe("/a");
  expect(res.headers.get("x-cache")).toBe("no");
});

test("stream wraps a ReadableStream with octet-stream default", async () => {
  const encoder = new TextEncoder();
  const res = stream(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("abc"));
        controller.close();
      },
    }),
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/octet-stream");
  expect(await res.text()).toBe("abc");
});

test("stream accepts Blob, Uint8Array and ArrayBuffer", async () => {
  expect(await stream(new Blob(["blob"])).text()).toBe("blob");
  expect(await stream(new TextEncoder().encode("bytes")).text()).toBe("bytes");
  const buf = new ArrayBuffer(3);
  new Uint8Array(buf).set([1, 2, 3]);
  expect([...new Uint8Array(await stream(buf).arrayBuffer())]).toEqual([1, 2, 3]);
});

test("stream honors init content-type and status", async () => {
  const res = stream(new Blob(["csv"]), { status: 201, headers: { "content-type": "text/csv" } });
  expect(res.headers.get("content-type")).toBe("text/csv");
  expect(res.status).toBe(201);
  expect(await res.text()).toBe("csv");
});
