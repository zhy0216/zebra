import type { StandardSchemaV1 } from "./standard-schema.ts";
import type {
  ContractProcedure,
  ContractProcedureDef,
  ErrorSpec,
  Method,
  ProcedureMeta,
} from "./types.ts";

type BaseDef<M extends Method, Path extends string> = {
  readonly version: 1;
  readonly method: M;
  readonly path: Path;
  readonly params: undefined;
  readonly query: undefined;
  readonly body: undefined;
  readonly output: undefined;
  readonly status: 200;
  readonly errors: {};
  readonly meta: undefined;
};

type Next<Def extends ContractProcedureDef, K extends keyof Def, V> = Omit<Def, K> & {
  [P in K]: V;
};

export class ContractProcedureImpl<Def extends ContractProcedureDef>
  implements ContractProcedure<Def>
{
  private constructor(readonly def: Def) {
    Object.freeze(this.def);
    Object.freeze(this);
  }

  static create<const M extends Method, const Path extends string>(
    method: M,
    path: Path,
  ): ContractProcedure<BaseDef<M, Path>> {
    return new ContractProcedureImpl<BaseDef<M, Path>>({
      version: 1,
      method,
      path,
      params: undefined,
      query: undefined,
      body: undefined,
      output: undefined,
      status: 200,
      errors: {},
      meta: undefined,
    });
  }

  /** Internal: rebuild a procedure from a (possibly modified) def. */
  static fromDef<Def extends ContractProcedureDef>(def: Def): ContractProcedure<Def> {
    return new ContractProcedureImpl(def);
  }

  params<S extends StandardSchemaV1>(schema: S): ContractProcedure<Next<Def, "params", S>> {
    const next = {
      version: 1,
      method: this.def.method,
      path: this.def.path,
      params: schema,
      query: this.def.query,
      body: this.def.body,
      output: this.def.output,
      status: this.def.status,
      errors: this.def.errors,
      meta: this.def.meta,
    } as Next<Def, "params", S>;
    return new ContractProcedureImpl<Next<Def, "params", S>>(next);
  }

  query<S extends StandardSchemaV1>(schema: S): ContractProcedure<Next<Def, "query", S>> {
    const next = {
      version: 1,
      method: this.def.method,
      path: this.def.path,
      params: this.def.params,
      query: schema,
      body: this.def.body,
      output: this.def.output,
      status: this.def.status,
      errors: this.def.errors,
      meta: this.def.meta,
    } as Next<Def, "query", S>;
    return new ContractProcedureImpl<Next<Def, "query", S>>(next);
  }

  body<S extends StandardSchemaV1>(
    schema: Def["method"] extends "GET" | "HEAD" ? never : S,
  ): ContractProcedure<Next<Def, "body", S>> {
    if (this.def.method === "GET" || this.def.method === "HEAD") {
      throw new Error("Contract .body() is not allowed on GET/HEAD procedures");
    }
    const next = {
      version: 1,
      method: this.def.method as Def["method"],
      path: this.def.path,
      params: this.def.params,
      query: this.def.query,
      body: schema as S,
      output: this.def.output,
      status: this.def.status,
      errors: this.def.errors,
      meta: this.def.meta,
    } as Next<Def, "body", S>;
    return new ContractProcedureImpl<Next<Def, "body", S>>(next);
  }

  output<S extends StandardSchemaV1>(schema: S): ContractProcedure<Next<Def, "output", S>> {
    const next = {
      version: 1,
      method: this.def.method,
      path: this.def.path,
      params: this.def.params,
      query: this.def.query,
      body: this.def.body,
      output: schema,
      status: this.def.status,
      errors: this.def.errors,
      meta: this.def.meta,
    } as Next<Def, "output", S>;
    return new ContractProcedureImpl<Next<Def, "output", S>>(next);
  }

  status<const S extends number>(status: S): ContractProcedure<Next<Def, "status", S>> {
    const next = {
      version: 1,
      method: this.def.method,
      path: this.def.path,
      params: this.def.params,
      query: this.def.query,
      body: this.def.body,
      output: this.def.output,
      status,
      errors: this.def.errors,
      meta: this.def.meta,
    } as Next<Def, "status", S>;
    return new ContractProcedureImpl<Next<Def, "status", S>>(next);
  }

  errors<const E extends Record<string, ErrorSpec>>(
    es: E,
  ): ContractProcedure<Next<Def, "errors", Def["errors"] & E>> {
    const next = {
      version: 1,
      method: this.def.method,
      path: this.def.path,
      params: this.def.params,
      query: this.def.query,
      body: this.def.body,
      output: this.def.output,
      status: this.def.status,
      errors: { ...this.def.errors, ...es } as Def["errors"] & E,
      meta: this.def.meta,
    } as Next<Def, "errors", Def["errors"] & E>;
    return new ContractProcedureImpl<Next<Def, "errors", Def["errors"] & E>>(next);
  }

  meta<const M extends ProcedureMeta>(meta: M): ContractProcedure<Next<Def, "meta", M>> {
    const next = {
      version: 1,
      method: this.def.method,
      path: this.def.path,
      params: this.def.params,
      query: this.def.query,
      body: this.def.body,
      output: this.def.output,
      status: this.def.status,
      errors: this.def.errors,
      meta,
    } as Next<Def, "meta", M>;
    return new ContractProcedureImpl<Next<Def, "meta", M>>(next);
  }
}

/** Internal: rebuild a procedure from a (possibly modified) def. */
export function procedureFromDef<Def extends ContractProcedureDef>(
  def: Def,
): ContractProcedure<Def> {
  return ContractProcedureImpl.fromDef(def);
}

export const zc = {
  get: <const Path extends string>(path: Path) => ContractProcedureImpl.create("GET", path),
  post: <const Path extends string>(path: Path) => ContractProcedureImpl.create("POST", path),
  put: <const Path extends string>(path: Path) => ContractProcedureImpl.create("PUT", path),
  patch: <const Path extends string>(path: Path) => ContractProcedureImpl.create("PATCH", path),
  delete: <const Path extends string>(path: Path) => ContractProcedureImpl.create("DELETE", path),
  head: <const Path extends string>(path: Path) => ContractProcedureImpl.create("HEAD", path),
  options: <const Path extends string>(path: Path) => ContractProcedureImpl.create("OPTIONS", path),
};
