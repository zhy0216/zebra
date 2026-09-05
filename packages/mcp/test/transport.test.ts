import { expect, spyOn, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { zc } from "@zebra-web/contract";
import { Zebra } from "@zebra-web/core";
import { zodSchemaAdapter } from "@zebra-web/schema-zod";
import { createMcpServer } from "../src/index.ts";

test("SDK tools/call cancellation reaches a running Zebra handler", async () => {
  const entered = Promise.withResolvers<AbortSignal>();
  const release = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  let started = false;
  let abortEvents = 0;
  const app = new Zebra();
  const contract = { wait: zc.get("/wait").mcp("wait", "wait for cancellation") };
  app.implement(contract, {
    wait: async (req) => {
      started = true;
      req.signal.addEventListener(
        "abort",
        () => {
          abortEvents++;
        },
        { once: true },
      );
      entered.resolve(req.signal);
      await release.promise;
      finished.resolve();
      return { aborted: req.signal.aborted };
    },
  });
  const mcp = createMcpServer({ app, contract, schema: zodSchemaAdapter() });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const sent = spyOn(clientTransport, "send");
  try {
    await mcp.connect(serverTransport);
    await client.connect(clientTransport);
    const controller = new AbortController();
    const call = client.callTool({ name: "wait" }, undefined, { signal: controller.signal });
    const outcome = Promise.allSettled([call]);
    const signal = await entered.promise;
    expect(signal.aborted).toBe(false);
    controller.abort("cancel test");
    expect((await outcome)[0]?.status).toBe("rejected");
    // A subsequent protocol round-trip drains the preceding cancellation
    // notification, avoiding timer-based synchronization.
    await client.listTools();
    expect(
      sent.mock.calls.some(
        ([message]) => "method" in message && message.method === "notifications/cancelled",
      ),
    ).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(abortEvents).toBe(1);
  } finally {
    release.resolve();
    if (started) await finished.promise;
    await client.close();
    await mcp.close();
    sent.mockRestore();
  }
});
