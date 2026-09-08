import "reflect-metadata";
import { Zebra } from "../../../../packages/core/src/app/app.ts";

// Diagnose the unchanged dispatch.test.ts failure without altering its assertion.
for (const host of ["localhost", "127.0.0.1"]) {
  let zebraAddress: string | undefined;
  const app = new Zebra();
  app.get("/", (req) => {
    zebraAddress = req.ip;
    return new Response("ok");
  });
  const { port } = await app.listen({ port: 0 });
  try {
    await (await fetch(`http://${host}:${port}/`)).text();
  } finally {
    await app.stop();
  }

  let nativeAddress: string | undefined;
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      nativeAddress = server.requestIP(request)?.address;
      return new Response("ok");
    },
  });
  try {
    await (await fetch(`http://${host}:${server.port}/`)).text();
  } finally {
    await server.stop(true);
  }
  console.log(
    JSON.stringify({
      bun: Bun.version,
      host,
      zebraAddress: zebraAddress ?? null,
      nativeAddress: nativeAddress ?? null,
    }),
  );
}
