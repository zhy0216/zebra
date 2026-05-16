import "reflect-metadata";
import type { Identifier } from "./token.ts";

const INJECTABLE = Symbol.for("zebra.injectable");
const INJECT_PARAMS = Symbol.for("zebra.inject.params");

export function injectable(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(INJECTABLE, true, target);
  };
}

export function inject<T>(id: Identifier<T>): ParameterDecorator {
  return (target, _propertyKey, parameterIndex) => {
    const existing: Record<number, Identifier<any>> =
      Reflect.getMetadata(INJECT_PARAMS, target) ?? {};
    existing[parameterIndex] = id;
    Reflect.defineMetadata(INJECT_PARAMS, existing, target);
  };
}

export function isInjectable(cls: Function): boolean {
  return Reflect.getMetadata(INJECTABLE, cls) === true;
}

export function getConstructorDeps(cls: Function): Identifier<any>[] {
  const types: Function[] = Reflect.getMetadata("design:paramtypes", cls) ?? [];
  const explicit: Record<number, Identifier<any>> =
    Reflect.getMetadata(INJECT_PARAMS, cls) ?? {};
  return types.map((t, i) => explicit[i] ?? (t as Identifier<any>));
}
