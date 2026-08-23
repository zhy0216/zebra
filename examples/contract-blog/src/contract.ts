import { zc } from "@zebra-web/contract";
import { z } from "zod";

export const Blog = z.object({ id: z.number(), title: z.string(), content: z.string() });

export const blogContract = {
  list: zc
    .get("/blogs")
    .query(z.object({ page: z.coerce.number().min(1).default(1) }))
    .output(z.array(Blog)),
  get: zc
    .get("/blogs/:id")
    .params(z.object({ id: z.coerce.number().int() }))
    .output(Blog)
    .errors({ blog_not_found: { status: 404 } }),
  create: zc
    .post("/blogs")
    .body(z.object({ title: z.string().min(1), content: z.string() }))
    .output(Blog)
    .status(201)
    .meta({ summary: "Create a blog post", tags: ["blogs"] }),
  remove: zc
    .delete("/blogs/:id")
    .params(z.object({ id: z.coerce.number().int() }))
    .status(204),
};
