import { describe, expect, test } from "bun:test";
import { HttpError } from "@zebra-web/zebra";
import { buildForumApp } from "../src/app.ts";
import { AuthService, ForumStore } from "../src/services.ts";

describe("concurrent registration", () => {
  test("inserts only one account and keeps the winning password", async () => {
    const store = new ForumStore();
    const auth = new AuthService(store);
    const passwords = ["first-password", "second-password", "third-password"];
    // Each call passes its initial lookup before any awaited hash can resume.
    // The assertions discover the winner instead of assuming hash completion order.
    const results = await Promise.allSettled(
      passwords.map((password) => auth.register("ada", password)),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const winner = results.findIndex((result) => result.status === "fulfilled");
    const user = { id: 1, username: "ada" };
    expect(store.findUserById(1)).toEqual(user);
    expect(store.findUserById(2)).toBeUndefined();
    expect(await auth.login("ada", passwords[winner]!)).toEqual(user);
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        expect(result.value).toEqual(user);
      } else {
        expect(result.reason).toBeInstanceOf(HttpError);
        expect(result.reason.status).toBe(409);
        expect(result.reason.code).toBe("username_taken");
        await expect(auth.login("ada", passwords[index]!)).rejects.toMatchObject({
          status: 401,
          code: "invalid_credentials",
        });
      }
    }
    expect((await auth.register("grace", "another-password")).id).toBe(2);
  });

  test("allows different names to register in parallel", async () => {
    const store = new ForumStore();
    const auth = new AuthService(store);
    const names = ["ada", "grace", "linus"];
    const users = await Promise.all(names.map((name) => auth.register(name, `${name}-password`)));
    expect(new Set(users.map((user) => user.id)).size).toBe(names.length);
    for (const [index, name] of names.entries()) {
      expect(await auth.login(name, `${name}-password`)).toEqual(users[index]!);
    }
  });

  test("returns one success and username_taken responses through the HTTP API", async () => {
    const app = buildForumApp({ sessionSecret: "concurrent-registration-test" });
    const passwords = ["first-password", "second-password", "third-password"];
    const register = (password: string) =>
      app.dispatch(
        new Request("http://test.local/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "ada", password }),
        }),
      );
    try {
      const responses = await Promise.all(passwords.map(register));
      expect(responses.filter((response) => response.ok)).toHaveLength(1);
      for (const response of responses) {
        if (response.ok) {
          expect(await response.json()).toEqual({ id: 1, username: "ada" });
        } else {
          expect(response.status).toBe(409);
          expect(await response.json()).toMatchObject({
            type: "https://errors.zebra.dev/username_taken",
          });
        }
      }
    } finally {
      await app.stop();
    }
  });
});
