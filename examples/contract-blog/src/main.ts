import "reflect-metadata";
import { HttpError, Zebra } from "zebra";
import { blogContract } from "./contract.ts";
import { BlogRepo, BlogService } from "./services.ts";

const z = new Zebra();
z.injectSingleton(BlogRepo);
z.injectSingleton(BlogService);

// Bulk form with shared deps; per-procedure middlewares via { handler, middlewares }.
z.implement(blogContract, { blog: BlogService }, {
  list: async (_req, { blog }) => blog.list(),
  get: async (req, { blog }) => {
    const found = await blog.find(req.params.id);
    if (!found) throw new HttpError(404, "blog_not_found", `blog ${req.params.id} not found`);
    return found;
  },
  create: async (req, { blog }) => {
    const body = await req.body();
    return blog.create(body.title, body.content);
  },
  remove: async (req, { blog }) => {
    await blog.remove(req.params.id);
  },
});

// Single form with per-procedure deps + opts:
// z.implement(blogContract.get, { blog: BlogService }, handler, { middlewares: [mw] })

await z.listen({ port: 3001 });
console.log("contract-blog example on http://localhost:3001");
