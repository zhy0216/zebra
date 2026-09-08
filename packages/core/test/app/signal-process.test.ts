import { expect, test } from "bun:test";
import type { SignalReport } from "./fixtures/signal-owner.ts";

function spawnApp(ownership: "false" | "true" | "omitted", failure = "none") {
  const reports: SignalReport[] = [];
  let changed = Promise.withResolvers<void>();
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      "--no-env-file",
      `${import.meta.dir}/fixtures/signal-owner.ts`,
      ownership,
      failure,
    ],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
    killSignal: "SIGKILL",
    ipc(message: SignalReport) {
      reports.push(message);
      changed.resolve();
      changed = Promise.withResolvers<void>();
    },
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const exited = Promise.all([child.exited, stdout, stderr]).then(([code, out, err]) => ({
    code,
    stdout: out,
    stderr: err,
  }));
  return {
    child,
    reports,
    exited,
    async waitFor(event: string, predicate = (_report: SignalReport) => true) {
      for (;;) {
        const report = reports.find((entry) => entry.event === event && predicate(entry));
        if (report) return report;
        await Promise.race([
          changed.promise,
          exited.then((result) => {
            throw new Error(
              `child exited before ${event}: ${JSON.stringify({ ...result, reports })}`,
            );
          }),
        ]);
      }
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    },
  };
}

test.each(["none", "stop", "flush"])(
  "application owns repeated real SIGTERM through drain and flush (failure: %s)",
  async (failure) => {
    const app = spawnApp("false", failure);
    let response: Promise<{ status: number; body: unknown }> | undefined;
    try {
      expect((await app.waitFor("prepared")).listeners).toEqual([0, 0]);
      const ready = await app.waitFor("ready");
      expect(ready.listeners).toEqual([1, 1]);
      expect(ready.port).toBeGreaterThan(0);
      response = fetch(`http://127.0.0.1:${ready.port}/slow`, {
        signal: AbortSignal.timeout(15_000),
      }).then(async (res) => ({ status: res.status, body: await res.json() }));
      void response.catch(() => {});
      await app.waitFor("request-started");

      // IPC only controls barriers; every shutdown signal goes through the OS.
      process.kill(app.child.pid, "SIGTERM");
      expect(await app.waitFor("draining")).toMatchObject({
        signals: 1,
        shutdowns: 0,
        listeners: [1, 1],
      });
      process.kill(app.child.pid, "SIGTERM");
      expect(await app.waitFor("signal", (report) => report.signals === 2)).toMatchObject({
        stage: "draining",
        shutdowns: 0,
        listeners: [1, 1],
      });
      expect(app.child.exitCode).toBeNull();
      expect(app.reports.some((report) => report.event === "shutdown")).toBe(false);
      app.child.send("release-request");
      expect(await response).toEqual({ status: 200, body: "drained" });

      expect(await app.waitFor("flush-started")).toMatchObject({ shutdowns: 1, listeners: [1, 1] });
      process.kill(app.child.pid, "SIGTERM");
      expect(await app.waitFor("signal", (report) => report.signals === 3)).toMatchObject({
        stage: "flushing",
        shutdowns: 1,
        listeners: [1, 1],
      });
      expect(app.child.exitCode).toBeNull();
      expect(app.reports.some((report) => report.event === "resource-closed")).toBe(false);
      expect(app.reports.some((report) => report.event === "complete")).toBe(false);
      app.child.send("release-flush");

      const result = await app.exited;
      expect(result.code).toBe(failure === "none" ? 0 : 1);
      expect(app.child.signalCode).toBeNull();
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("");
      expect(app.reports.filter((report) => report.event === "shutdown")).toHaveLength(1);
      expect(app.reports.at(-1)).toMatchObject({
        event: "complete",
        signals: 3,
        shutdowns: 1,
        listeners: [1, 1],
      });
      const events = app.reports.map((report) => report.event);
      expect(events).toEqual([
        "prepared",
        "ready",
        "request-started",
        "signal",
        "draining",
        "signal",
        "request-finished",
        "shutdown",
        ...(failure === "stop" ? ["stop-error"] : []),
        "flush-started",
        "signal",
        ...(failure === "flush" ? ["flush-error"] : ["flush-finished", "resource-closed"]),
        "complete",
      ]);
      if (failure === "stop") {
        expect(app.reports.find((report) => report.event === "stop-error")?.error).toContain(
          "shutdown hook failed",
        );
      } else if (failure === "flush") {
        expect(app.reports.find((report) => report.event === "flush-error")?.error).toContain(
          "application flush failed",
        );
      }
    } finally {
      await app.close();
      await response?.catch(() => {});
    }
  },
  20_000,
);

for (const ownership of ["omitted", "true"] as const) {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    test.each(["none", "stop"])(
      `signalHandlers ${ownership} automatically handles real ${signal} (failure: %s)`,
      async (failure) => {
        const app = spawnApp(ownership, failure);
        try {
          expect((await app.waitFor("prepared")).listeners).toEqual([0, 0]);
          expect((await app.waitFor("ready")).listeners).toEqual([1, 1]);
          process.kill(app.child.pid, signal);
          expect(await app.waitFor("shutdown")).toMatchObject({
            signals: 0,
            shutdowns: 1,
            listeners: [0, 0],
          });
          app.child.send("finish-default");
          const result = await app.exited;
          expect(result.code).toBe(0);
          expect(app.child.signalCode).toBeNull();
          expect(app.reports.filter((report) => report.event === "shutdown")).toHaveLength(1);
          if (failure === "stop") {
            expect(result.stderr).toContain("[zebra] shutdown failed:");
            expect(result.stderr.match(/\[zebra\] shutdown failed:/g)).toHaveLength(1);
            expect(result.stderr).toContain("shutdown hook failed");
            expect(app.reports.find((report) => report.event === "cached-error")?.error).toContain(
              "shutdown hook failed",
            );
          } else {
            expect(result.stderr).toBe("");
          }
          expect(app.reports.at(-1)).toMatchObject({
            event: "complete",
            shutdowns: 1,
            listeners: [0, 0],
          });
        } finally {
          await app.close();
        }
      },
      20_000,
    );
  }
}
