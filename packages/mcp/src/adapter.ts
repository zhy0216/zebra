import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  type ListToolsResult,
  McpError,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { ContractRouter } from "@zebra/contract";
import type { Zebra } from "@zebra/core";
import { argumentsToRequest, responseToResult } from "./bridge.ts";
import { type SchemaAdapter, collectTools, toTool } from "./manifest.ts";

export type { SchemaAdapter };

/** Per-call context passed to a header mapper (see `McpServerOptions.headers`). */
export interface McpCallContext {
  readonly name: string;
  readonly arguments: unknown;
}

/** Structured log line for a tool call (opt-in via `McpServerOptions.logger`). */
export interface McpLogEntry {
  readonly requestId: string;
  readonly tool: string;
  readonly status: number;
  readonly durationMs: number;
}

function createRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface McpServerOptions {
  /** The Zebra app that implements the contract. */
  app: Zebra;
  /** The same contract passed to `app.implement`. */
  contract: ContractRouter;
  /** Schema adapter (e.g. `zodSchemaAdapter()` from `@zebra/schema-zod`). */
  schema: SchemaAdapter;
  /** Server name advertised during MCP initialization. Default `"zebra-mcp"`. */
  name?: string;
  /** Server version advertised during MCP initialization. Default `"1.0.0"`. */
  version?: string;
  /**
   * Base URL used to build the internal HTTP requests for dispatch.
   * Default `http://mcp.local`.
   */
  baseUrl?: string;
  /**
   * Static request headers, or a function mapping the call context to headers.
   * Useful to forward MCP session context (e.g. an auth token) into Zebra's
   * middleware. These are defaults — per-call `arguments.headers` win.
   */
  headers?:
    | Record<string, string>
    | ((ctx: McpCallContext) => Record<string, string> | Promise<Record<string, string>>);
  /** Opt-in structured logger for tool calls (request id + tool name + status). */
  logger?: (entry: McpLogEntry) => void;
}

export interface ZebraMcpServer {
  /** Tools discovered from the contract (only `.mcp()`-declared procedures). */
  readonly tools: ReadonlyArray<Tool>;
  /** The underlying MCP `Server`; connect transports via `connect()`. */
  readonly server: Server;
  /** MCP `tools/list` — also used as the SDK request handler. */
  listTools(): Promise<ListToolsResult>;
  /** MCP `tools/call` — also used as the SDK request handler. */
  callTool(input: {
    name: string;
    arguments?: unknown;
    signal?: AbortSignal;
  }): Promise<CallToolResult>;
  /** Connects the SDK server to an MCP transport (stdio / SSE / streamable HTTP). */
  connect(transport: Transport): Promise<void>;
  close(): Promise<void>;
}

/**
 * Creates an MCP server adapter over a Zebra app. MCP `tools/call` arguments
 * are mapped to an HTTP `Request` and run through `app.dispatch()`, so the
 * full Zebra pipeline — middleware, DI, auth, session, rate-limit, contract
 * validation — applies unchanged. HTTP and MCP share the same contract.
 */
export function createMcpServer(opts: McpServerOptions): ZebraMcpServer {
  const baseUrl = opts.baseUrl ?? "http://mcp.local";
  const manifests = collectTools(opts.contract, opts.schema);
  const tools = manifests.map(toTool);

  const sdk = new Server(
    { name: opts.name ?? "zebra-mcp", version: opts.version ?? "1.0.0" },
    { capabilities: { tools: {} } },
  );

  const resolveHeaders = (ctx: McpCallContext): Promise<Record<string, string>> => {
    const h = opts.headers;
    if (h === undefined) return Promise.resolve({});
    if (typeof h === "function") return Promise.resolve(h(ctx));
    return Promise.resolve(h);
  };

  const server: ZebraMcpServer = {
    tools,
    server: sdk,
    async listTools(): Promise<ListToolsResult> {
      return { tools: [...tools] };
    },
    async callTool(input): Promise<CallToolResult> {
      const manifest = manifests.find((m) => m.name === input.name);
      if (manifest === undefined) {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${input.name}`);
      }
      const requestId = createRequestId();
      const headers = await resolveHeaders({ name: input.name, arguments: input.arguments });
      const started = performance.now();
      const request = argumentsToRequest(manifest.def, input.arguments, baseUrl, headers, {
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
      });
      const res = await opts.app.dispatch(request);
      const result = await responseToResult(res);
      opts.logger?.({
        requestId,
        tool: input.name,
        status: res.status,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      });
      return result;
    },
    connect(transport) {
      return sdk.connect(transport);
    },
    close() {
      return sdk.close();
    },
  };

  sdk.setRequestHandler(ListToolsRequestSchema, async () => server.listTools());
  sdk.setRequestHandler(CallToolRequestSchema, async (request) => server.callTool(request.params));

  return server;
}
