import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Observe the unchanged gate through its existing measurement injection argument.
// Keep default options, all three runs, median-by-rps selection and original thresholds.
const root = realpathSync(resolve(process.argv[2]));
process.env.NODE_ENV = "production";
const load = (path) => import(pathToFileURL(join(root, path)).href);
const gate = await load("bench/bench-regression.ts");
const runner = await load("bench/runner.ts");
const server = await load("bench/zebra-bench.ts");
const facade = Bun.resolveSync("@zebra-web/zebra", join(root, "bench"));
if (!realpathSync(facade).startsWith(`${root}/packages/`)) {
  throw new Error(`HTTP control resolved outside its source tree: ${facade}`);
}
console.log(
  JSON.stringify({
    type: "environment",
    root,
    bun: Bun.version,
    revision: Bun.revision,
    facade: realpathSync(facade),
  }),
);
try {
  await gate.runRegression(
    gate.parseOptions(process.env),
    false,
    join(root, "bench/baseline.json"),
    server.start,
    async (baseUrl, options, scenario) => {
      const samples = [];
      for (let round = 1; round <= 3; round++) {
        const sample = await runner.runScenario(baseUrl, options, scenario);
        samples.push(sample);
        console.log(JSON.stringify({ type: "sample", scenario: scenario.name, round, ...sample }));
      }
      samples.sort((a, b) => a.rps - b.rps);
      console.log(JSON.stringify({ type: "median", scenario: scenario.name, ...samples[1] }));
      return samples[1];
    },
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
