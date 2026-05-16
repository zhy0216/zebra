export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly title: string,
    public readonly detail?: unknown,
  ) {
    super(title);
    this.name = "HttpError";
  }
}

export interface ProblemJson {
  type: string;
  status: number;
  title: string;
  detail?: unknown;
  instance: string;
  stack?: string;
}

export function toProblemJson(
  err: unknown,
  instance: string,
  opts: { exposeStack?: boolean } = {},
): ProblemJson {
  if (err instanceof HttpError) {
    const p: ProblemJson = {
      type: `https://errors.zebra.dev/${err.code}`,
      status: err.status,
      title: err.title,
      instance,
    };
    if (err.detail !== undefined) p.detail = err.detail;
    return p;
  }
  const p: ProblemJson = {
    type: "https://errors.zebra.dev/internal",
    status: 500,
    title: "Internal Server Error",
    instance,
  };
  if (opts.exposeStack && err instanceof Error && err.stack !== undefined) {
    p.stack = err.stack;
  }
  return p;
}
