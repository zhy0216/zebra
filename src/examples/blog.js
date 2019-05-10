"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const knex_1 = __importDefault(require("knex"));
const app_1 = require("../lib/app");
const knex = knex_1.default({
    client: "sqlite3",
    connection: {
        filename: ":memory:"
    },
    useNullAsDefault: true
});
app_1.z.addBeforeRun(async function init() {
    await knex.schema.createTable("blog", (table) => {
        table.increments();
        table.string("title");
        table.text("content");
        table.timestamp("created_at").defaultTo(knex.fn.now());
    });
});
app_1.z.addBeforeStop(async () => {
    await knex.destroy();
});
app_1.z.addGet("/blogs/", async function allBlog() {
    return knex("blog");
});
app_1.z.addPost("/blogs/", async function newBlog(body) {
    const blogIdQuery = await knex("blog").insert(body);
    return { id: blogIdQuery[0] };
});
app_1.z.addDelete("/blogs/{blogId}/", async (blogId) => {
    await knex("blog").where("id", blogId).del();
    return {};
});
app_1.z.addPatch("/blogs/{blogId}/", async (blogId, body) => {
    await knex("blog").where("id", blogId).update(body);
    return {};
});
if (require.main === module) {
    app_1.z.run();
}
