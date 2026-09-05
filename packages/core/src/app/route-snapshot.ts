import type { ContractProcedureDef } from "../contract/protocol.ts";

export function snapshotContract(
  contract: ContractProcedureDef,
  snapshots: WeakMap<object, object>,
): ContractProcedureDef {
  return copyProperties(contract, {}, snapshots);
}

function snapshotData(value: unknown, snapshots: WeakMap<object, object>): unknown {
  if (value === null || typeof value !== "object") return value;
  const existing = snapshots.get(value);
  if (existing) return existing;

  // Presence alone keeps even plain-object schemas opaque without invoking getters.
  if ("~standard" in value) return value;
  const prototype = Object.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  if (prototype !== null && prototype !== (isArray ? Array.prototype : Object.prototype)) {
    return value;
  }
  const target = isArray ? Object.setPrototypeOf([], prototype) : Object.create(prototype);
  return copyProperties(value, target, snapshots);
}

function copyProperties<T extends object>(
  source: T,
  target: object,
  snapshots: WeakMap<object, object>,
): T {
  const existing = snapshots.get(source);
  if (existing) return existing as T;
  // Register before descending so cycles and aliases share the same owned copy.
  snapshots.set(source, target);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)!;
    if ("value" in descriptor) descriptor.value = snapshotData(descriptor.value, snapshots);
    Object.defineProperty(target, key, descriptor);
  }
  return Object.freeze(target) as T;
}
