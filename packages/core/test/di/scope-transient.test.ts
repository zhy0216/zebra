import "reflect-metadata";
import { expect, test } from "bun:test";
import { Container } from "../../src/di/container.ts";
import { injectable } from "../../src/di/decorators.ts";

@injectable()
class Counter {
  static n = 0;
  readonly id = ++Counter.n;
}

test("transient: each resolve returns a new instance", () => {
  Counter.n = 0;
  const c = new Container();
  c.bind(Counter).toSelf().inTransientScope();
  const a = c.resolve(Counter);
  const b = c.resolve(Counter);
  expect(a.id).toBe(1);
  expect(b.id).toBe(2);
  expect(a).not.toBe(b);
});
