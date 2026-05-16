import { Zebra, type ZebraOptions, validateGraph } from "@zebra/core";

export interface TestApp extends Zebra {
  request(path: string, init?: RequestInit): Promise<Response>;
  boot(): Promise<void>;
}

export function createTestApp(opts: ZebraOptions): TestApp {
  const app = new Zebra(opts) as TestApp;
  app.request = (path: string, init?: RequestInit) => {
    const url = path.startsWith("http") ? path : `http://test.local${path}`;
    return app.dispatch(new Request(url, init));
  };
  app.boot = async () => {
    validateGraph((app as any).container, (app as any).routes, (app as any).middlewares);
  };
  return app;
}
