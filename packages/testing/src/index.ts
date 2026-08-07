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
