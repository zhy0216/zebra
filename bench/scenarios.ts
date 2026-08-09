export interface BenchServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

export interface BenchOptions {
  durationMs: number;
  concurrency: number;
}

export interface Scenario {
  name: string;
  path: string;
  verify: (body: string) => boolean;
}

export interface ScenarioResult {
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  requests: number;
}

export const MIDDLEWARE_LAYERS = 5;

export const JSON_PAYLOAD = {
  hello: "world",
  arr: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
};

export const SCENARIOS: Scenario[] = [
  { name: "static", path: "/hello", verify: (b) => b === "hello world" },
  { name: "param", path: "/user/42", verify: (b) => b === "42" },
  { name: "wildcard", path: "/wild/a/b/c", verify: (b) => b === "a/b/c" },
  { name: "middleware", path: "/middleware", verify: (b) => b === "middleware ok" },
  {
    name: "json",
    path: "/json",
    verify: (b) => {
      try {
        const j = JSON.parse(b);
        return j.hello === "world" && Array.isArray(j.arr) && j.arr.length === 10;
      } catch {
        return false;
      }
    },
  },
];
