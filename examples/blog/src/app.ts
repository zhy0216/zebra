import { HttpError, Zebra } from "zebra";
import { BlogRepo, BlogService } from "./services.ts";

/** Composition root: everything main.ts runs, without the listen(). */
export function buildBlogApp(): Zebra {
  const z = new Zebra();
  z.injectSingleton(BlogRepo);
  z.injectSingleton(BlogService);

  z.group("/blogs", (g) => {
    g.get("/", { blog: BlogService }, async (_req, { blog }) => blog.list());

    g.get("/:id", { blog: BlogService }, async (req, { blog }) => {
      const id = Number(req.params.id);
      const found = await blog.find(id);
      if (!found) throw new HttpError(404, "blog_not_found", `blog ${id} not found`);
      return found;
    });

    g.post("/", { blog: BlogService }, async (req, { blog }) => {
      const body = (await req.body()) as { title: string; content: string };
      return blog.create(body.title, body.content);
    });

    g.delete("/:id", { blog: BlogService }, async (req, { blog }) => {
      const ok = await blog.remove(Number(req.params.id));
      if (!ok) throw new HttpError(404, "blog_not_found", "no such blog");
      return { deleted: true };
    });
  });

  return z;
}
