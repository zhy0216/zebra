import knex_connect from "knex";
import { z } from "../lib/app";

const knex = knex_connect({
    client: "sqlite3",
    connection: {
        filename: ":memory:"
    },
    useNullAsDefault: true
});

z.addBeforeRun(async function init() {
    await knex.schema.createTable("blog", (table) => {
        table.increments();
        table.string("title");
        table.text("content");
        table.timestamp("created_at").defaultTo(knex.fn.now());
    });
});

z.addBeforeStop(async () => {
    await knex.destroy();
});

z.get("/blogs/", async function allBlog() {
    return knex("blog");
});


interface BlogJson {
    title: string;
    content: string;
}

z.post("/blogs/", async function newBlog(body: BlogJson) {
    const blogIdQuery = await knex("blog").insert(body);
    return {id: blogIdQuery[0]};
});

z.delete("/blogs/{blogId}/", async (blogId) => {
    await knex("blog").where("id", blogId).del();
    return {};
});

z.patch("/blogs/{blogId}/", async (blogId, body: BlogJson) => {
    await knex("blog").where("id", blogId).update(body);
    return {};
});


if (require.main === module) {
    z.run();
}
