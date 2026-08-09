import "reflect-metadata";
import { buildApp } from "./app.ts";

const app = await buildApp();
await app.listen({ port: 3003 });
console.log("better-auth example listening on http://localhost:3003");
