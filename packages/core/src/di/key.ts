import { type Identifier, isToken } from "./token.ts";

export type BindingKey = symbol | Function;

export function keyOf<T>(id: Identifier<T>): BindingKey {
  return isToken(id) ? id.id : id;
}

export function displayName<T>(id: Identifier<T>): string {
  return isToken(id) ? id.name : (id as Function).name;
}
