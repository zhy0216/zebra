export type Middleware = (req: any, next: () => Promise<Response>) => Promise<Response>;
