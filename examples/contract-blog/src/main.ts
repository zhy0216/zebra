import "reflect-metadata";
import { buildContractBlogApp } from "./app.ts";

// Single form with per-procedure deps + opts:
// z.implement(blogContract.get, { blog: BlogService }, handler, { middlewares: [mw] })

await buildContractBlogApp().listen({ port: 3001 });
console.log("contract-blog example on http://localhost:3001");
