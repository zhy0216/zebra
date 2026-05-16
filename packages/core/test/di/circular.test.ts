import "reflect-metadata";
import { test, expect } from "bun:test";
import { Container } from "../../src/di/container.ts";
import { injectable, inject } from "../../src/di/decorators.ts";
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
