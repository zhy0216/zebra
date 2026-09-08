import { Zebra, type ZebraOptions } from "../../../src/index.ts";

export interface SignalReport {
  event: string;
  stage: string;
  signals: number;
  shutdowns: number;
  listeners: number[];
  port?: number;
  error?: string;
}

const ownership = process.argv[2];
const failure = process.argv[3];
const options: ZebraOptions =
  ownership === "omitted" ? {} : { signalHandlers: ownership === "true" };
const app = new Zebra({ ...options, gracePeriod: 10_000 });
const requestGate = Promise.withResolvers<void>();
const flushGate = Promise.withResolvers<void>();
let stage = "running";
let signals = 0;
let shutdowns = 0;
let stopping: Promise<void> | undefined;

function report(event: string, extra: Partial<SignalReport> = {}) {
  process.send!({
    event,
    stage,
    signals,
    shutdowns,
    listeners: [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")],
    ...extra,
  } satisfies SignalReport);
}

app.get("/slow", async () => {
  report("request-started");
  await requestGate.promise;
  report("request-finished");
  return "drained";
});
app.on("shutdown", () => {
  shutdowns++;
  report("shutdown");
  if (failure === "stop") throw new Error("shutdown hook failed");
});

async function shutdownApplication() {
  stage = "draining";
  report("draining");
  let exitCode = 0;
  try {
    await app.stop();
  } catch (error) {
    exitCode = 1;
    report("stop-error", { error: String(error) });
  }
  stage = "flushing";
  report("flush-started");
  try {
    await flushGate.promise;
    if (failure === "flush") throw new Error("application flush failed");
    report("flush-finished");
    report("resource-closed");
  } catch (error) {
    exitCode = 1;
    report("flush-error", { error: String(error) });
  }
  stage = "complete";
  report("complete");
  process.exitCode = exitCode;
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  process.disconnect!();
}

function onSignal() {
  signals++;
  report("signal");
  if (!stopping) stopping = Promise.resolve().then(shutdownApplication);
}

process.on("message", async (command) => {
  if (command === "release-request") requestGate.resolve();
  else if (command === "release-flush") flushGate.resolve();
  else if (command === "finish-default") {
    // Observe the cached outcome after the framework's signal-triggered stop.
    try {
      await app.stop();
    } catch (error) {
      report("cached-error", { error: String(error) });
    }
    report("complete");
    process.disconnect!();
  }
});

await app.prepare();
report("prepared");
if (ownership === "false") {
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}
const { port } = await app.listen({ port: 0, hostname: "127.0.0.1" });
report("ready", { port });
