import "reflect-metadata";
import { buildBlogApp } from "./app.ts";

await buildBlogApp().listen({ port: 3001 });
console.log("blog example on http://localhost:3001");
