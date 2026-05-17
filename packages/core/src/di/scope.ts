export enum ScopeKind {
  Singleton = "singleton",
  Session = "session",
  Request = "request",
  Transient = "transient",
}

const ORDER: Record<ScopeKind, number> = {
  [ScopeKind.Singleton]: 0,
  [ScopeKind.Session]: 1,
  [ScopeKind.Request]: 2,
  [ScopeKind.Transient]: 3,
};

export function scopeRank(s: ScopeKind): number {
  return ORDER[s];
}

export function canDependOn(consumer: ScopeKind, dependency: ScopeKind): boolean {
  // Transient has no cache, so any scope can safely depend on it.
  if (dependency === ScopeKind.Transient) return true;
  return scopeRank(dependency) <= scopeRank(consumer);
}
