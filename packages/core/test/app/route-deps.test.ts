import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";
import { injectable } from "../../src/di/decorators.ts";

@injectable()
class BlogService {
  async find(id: string) {
    return { id, title: `blog ${id}` };
  }
}

test("handler receives resolved deps as second arg", async () => {
  const c = new Container();
  c.bind(BlogService).toSelf();
  const app = new Zebra({ container: c });
  app.get("/blogs/:id", { blog: BlogService }, async (req, { blog }) => {
    return blog.find(req.params.id);
  });

  const res = await app.dispatch(new Request("http://x/blogs/42"));
  expect(await res.json()).toEqual({ id: "42", title: "blog 42" });
});
