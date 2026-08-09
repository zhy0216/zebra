import type { ProblemJson } from "./protocol.ts";

/** Thrown for any non-2xx response. */
export class ClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly problem: ProblemJson,
    public readonly response: Response,
  ) {
    super(problem.title);
    this.name = "ClientError";
  }
}
