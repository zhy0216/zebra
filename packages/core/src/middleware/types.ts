export type DepsRecord = Record<string, unknown>;

export type Middleware<D extends DepsRecord = {}> = (
  req: any,
  next: () => Promise<Response>,
  deps?: D,
) => Promise<Response>;

export type DepsSpec = Record<string, any>;
