import "reflect-metadata";
import { buildHelloApp } from "./app.ts";

await buildHelloApp().listen({ port: 3000 });
console.log("hello example listening on http://localhost:3000");
