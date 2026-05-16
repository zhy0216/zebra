const TOKEN_BRAND = Symbol.for("zebra.token");

export interface Token<T> {
  readonly [TOKEN_BRAND]: true;
  readonly id: symbol;
  readonly name: string;
  readonly __type?: T;
}

export function token<T>(name: string): Token<T> {
  return { [TOKEN_BRAND]: true, id: Symbol(name), name };
}

export function isToken(x: unknown): x is Token<unknown> {
  return typeof x === "object" && x !== null && (x as any)[TOKEN_BRAND] === true;
}

export type ClassConstructor<T> = new (...args: any[]) => T;
export type Identifier<T> = Token<T> | ClassConstructor<T>;
