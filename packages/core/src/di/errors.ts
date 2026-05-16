export class CircularDependencyError extends Error {
  constructor(public readonly path: string[]) {
    super(`Circular dependency: ${path.join(" -> ")}`);
    this.name = "CircularDependencyError";
  }
}

export class UnboundTokenError extends Error {
  constructor(
    public readonly identifier: string,
    public readonly path: string[],
  ) {
    super(`Unbound identifier "${identifier}" required by: ${path.join(" -> ")}`);
    this.name = "UnboundTokenError";
  }
}

export class ScopeMismatchError extends Error {
  constructor(
    public readonly dependency: string,
    public readonly dependencyScope: string,
    public readonly consumer: string,
    public readonly consumerScope: string,
  ) {
    super(
      `Scope mismatch: ${consumer} (${consumerScope}) cannot depend on ${dependency} (${dependencyScope})`,
    );
    this.name = "ScopeMismatchError";
  }
}
