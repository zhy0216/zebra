import type { StandardSchemaV1 } from "./standard-schema.ts";

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type Method = (typeof METHODS)[number];

export interface ErrorSpec {
  status: number;
}

/** MCP annotations for a procedure exposed as a tool (parity with @zebra-web/contract). */
export interface McpOptions {
  title?: string;
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  openWorld?: boolean;
}

/** Resolved `.mcp()` declaration (parity with @zebra-web/contract). */
export interface McpDeclaration extends McpOptions {
  readonly name: string;
  readonly description: string;
}

/**
 * Frozen pure-data description of a contract procedure. Structurally identical
 * to @zebra-web/contract's ContractProcedureDef. All fields required-but-undefined
 * (never optional) to sidestep exactOptionalPropertyTypes variance issues.
 */
export interface ContractProcedureDef {
  readonly version: 1;
  readonly method: Method;
  readonly path: string;
  readonly params: StandardSchemaV1 | undefined;
  readonly query: StandardSchemaV1 | undefined;
  readonly body: StandardSchemaV1 | undefined;
  readonly output: StandardSchemaV1 | undefined;
  readonly status: number;
  readonly errors: Record<string, ErrorSpec>;
  readonly meta: Readonly<Record<string, unknown>> | undefined;
  readonly mcp: McpDeclaration | undefined;
}


export type ContractProcedure = { readonly def: ContractProcedureDef };
export interface ContractRouter { readonly [key: string]: ContractProcedure | ContractRouter }
export type { StandardSchemaV1 };
