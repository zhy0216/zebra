import { test, expect } from "bun:test";
import { Container } from "../../src/di/container.ts";

class NoDeps {
  hello() { return "hi"; }
}

test("toSelf on a no-arg class instantiates it", () => {
  const c = new Container();
  c.bind(NoDeps).toSelf();
  const instance = c.resolve(NoDeps);
  expect(instance).toBeInstanceOf(NoDeps);
  expect(instance.hello()).toBe("hi");
});

test("singleton class: same instance", () => {
  const c = new Container();
  c.bind(NoDeps).toSelf();
  expect(c.resolve(NoDeps)).toBe(c.resolve(NoDeps));
});

test(".to(OtherClass) replaces target", () => {
  abstract class Animal { abstract sound(): string; }
  class Dog extends Animal { sound() { return "woof"; } }
  const c = new Container();
  c.bind(Animal).to(Dog);
  expect(c.resolve(Animal).sound()).toBe("woof");
});
