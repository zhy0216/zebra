import "reflect-metadata";
import { expect, test } from "bun:test";
import { Container, injectable } from "@zebra/core";
import { createTestApp } from "../src/index.ts";

@injectable()
class Echo {
  say(msg: string) {
    return msg;
  }
}

test("createTestApp dispatches in-process without opening a port", async () => {
  const c = new Container();
  c.bind(Echo).toSelf();
  const app = createTestApp({ container: c });
  app.get("/echo/:msg", { echo: Echo }, async (req, { echo }) => echo.say(req.params.msg));

  const res = await app.request("/echo/hello");
  expect(await res.json()).toBe("hello");
});

test("container.rebind works for mocking", async () => {
  const c = new Container();
  c.bind(Echo).toSelf();
  const app = createTestApp({ container: c });
  app.get("/echo/:msg", { echo: Echo }, async (req, { echo }) => echo.say(req.params.msg));

  c.rebind(Echo).toValue({ say: () => "mocked" } as Echo);
  const res = await app.request("/echo/hello");
  expect(await res.json()).toBe("mocked");
});

test("createTestApp runs boot validation eagerly", async () => {
  const c = new Container();
  // forgot to bind Echo
  const app = createTestApp({ container: c });
  app.get("/echo/:msg", { echo: Echo }, async (req, { echo }) => echo.say(req.params.msg));
  await expect(app.boot()).rejects.toThrow();
});
