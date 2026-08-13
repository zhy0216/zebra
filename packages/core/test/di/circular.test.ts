import "reflect-metadata";
import { expect, test } from "bun:test";
import { Container } from "../../src/di/container.ts";
import { inject, injectable } from "../../src/di/decorators.ts";
import { CircularDependencyError } from "../../src/di/errors.ts";
import { token } from "../../src/di/token.ts";

// NOTE: Forward-referencing classes in TypeScript decorator metadata
// triggers ES TDZ errors at class-declaration time, before the cycle
// can be detected at resolution time. We use tokens to break the static
// reference cycle while preserving the runtime dependency cycle.
interface IA { b: IB; }
interface IB { a: IA; }
const TokenA = token<IA>("A");
const TokenB = token<IB>("B");

@injectable()
class A { constructor(@inject(TokenB) public b: IB) {} }
@injectable()
class B { constructor(@inject(TokenA) public a: IA) {} }

test("self-referential resolution throws CircularDependencyError", () => {
  const c = new Container();
  c.bind(TokenA).to(A as any);
  c.bind(TokenB).to(B as any);
  expect(() => c.resolve(TokenA)).toThrow(CircularDependencyError);
});

test("distinct tokens with the same display name do not look circular", () => {
  const Left = token<string>("duplicate");
  const Right = token<string>("duplicate");
  const c = new Container();
  c.bind(Right).toValue("right");
  c.bind(Left).toFactoryWithDeps({ right: Right }, ({ right }) => `left:${right}`);
  expect(c.resolve(Left)).toBe("left:right");
});

test("lazy factories resolve through the calling stack and detect cycles", () => {
  const c = new Container();
  c.bind(TokenA).toFactory((ctr) => ctr.resolve(TokenB) as unknown as IA);
  c.bind(TokenB).toFactory((ctr) => ctr.resolve(TokenA) as unknown as IB);
  // A cycle across dependency-free factories surfaces as a readable
  // CircularDependencyError, not a RangeError from unbounded recursion.
  expect(() => c.resolve(TokenA)).toThrow(CircularDependencyError);
  expect(() => c.resolve(TokenB)).toThrow(CircularDependencyError);
});

test("a lazy factory resolving its own token detects the self-cycle", () => {
  const c = new Container();
  c.bind(TokenA).toFactory((ctr) => ctr.resolve(TokenA) as unknown as IA);
  expect(() => c.resolve(TokenA)).toThrow(CircularDependencyError);
});

test("a lazy factory can still resolve non-cyclic deps through the container", () => {
  const Name = token<string>("name");
  const Greet = token<string>("greet");
  const c = new Container();
  c.bind(Name).toValue("world");
  c.bind(Greet).toFactory((ctr) => `hello ${ctr.resolve(Name)}`);
  expect(c.resolve(Greet)).toBe("hello world");
});
