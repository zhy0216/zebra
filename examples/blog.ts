import knex_connect from 'knex';
import {z} from "../lib/app";

const knex = knex_connect({
    client: 'sqlite3',
    connection: {
        filename: ":memory:"
    },
    useNullAsDefault: true
});


z.addBeforeRun(async function init() {
    await knex.schema.createTable('blog', function (table) {
        table.increments();
        table.string('title');
        table.text('content');
        table.timestamp('created_at').defaultTo(knex.fn.now());
    });
});

z.addBeforeStop(async function() {
    await knex.destroy()
});

z.addGet("/blogs/", async function allBlog(){
    return await knex('blog')
});


interface BlogJson {
    title: string;
    content: string;
}

z.addPost("/blogs/", async function newBlog(body: BlogJson){
    const blogIdQuery = await knex('blog').insert(body);
    return {id: blogIdQuery[0]}
});

z.addDelete("/blogs/{blogId}/", async (blogId) => {
    await knex('blog').where('id', blogId).del();
    return {}
});

z.addPatch("/blogs/{blogId}/", async (blogId, body: BlogJson) => {
    await knex('blog').where('id', blogId).update(body);
    return {}
});


if (require.main === module) {
    z.run();
}