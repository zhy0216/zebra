import { type ContractClient, createClient } from "@zebra/client";
import type { ContractRouter } from "@zebra/contract";
import { Zebra, type ZebraOptions } from "@zebra/core";

export interface TestApp extends Zebra {
  request(path: string, init?: RequestInit): Promise<Response>;
  boot(): Promise<void>;
}

class TestZebra extends Zebra implements TestApp {
  async request(path: string, init?: RequestInit): Promise<Response> {
    await this.boot();
    const url = path.startsWith("http") ? path : `http://test.local${path}`;
    return this.dispatch(new Request(url, init));
  }

  async boot(): Promise<void> {
    await this.prepare();
  }
}

export function createTestApp(opts: ZebraOptions = {}): TestApp {
  return new TestZebra(opts);
}

/**
 * Socket-free typed client over a TestApp: contract → implement → request loop.
 */
export function createTestClient<R extends ContractRouter>(
  app: TestApp,
  router: R,
): ContractClient<R> {
  return createClient(router, {
    baseUrl: "http://test.local",
    fetch: (url, init) => app.request(url, init),
  });
}
