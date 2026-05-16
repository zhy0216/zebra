import "reflect-metadata";
import { Zebra, Container, HttpError } from "zebra";
import { BlogRepo, BlogService } from "./services.ts";

const container = new Container();
container.bind(BlogRepo).toSelf();
container.bind(BlogService).toSelf();

const app = new Zebra({ container });

app.group("/blogs", (g) => {
  g.get("/", { blog: BlogService }, async (_req, { blog }) => blog.list());

  g.get("/:id", { blog: BlogService }, async (req, { blog }) => {
    const id = Number(req.params.id);
    const found = await blog.find(id);
    if (!found) throw new HttpError(404, "blog_not_found", `blog ${id} not found`);
    return found;
  });

  g.post("/", { blog: BlogService }, async (req, { blog }) => {
    const body = await req.body() as { title: string; content: string };
    return blog.create(body.title, body.content);
  });

  g.delete("/:id", { blog: BlogService }, async (req, { blog }) => {
    const ok = await blog.remove(Number(req.params.id));
    if (!ok) throw new HttpError(404, "blog_not_found", "no such blog");
    return { deleted: true };
  });
});

await app.listen({ port: 3001 });
console.log("blog example on http://localhost:3001");
