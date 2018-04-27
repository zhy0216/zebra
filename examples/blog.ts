import knex_connect from 'knex';
import {z} from "../lib/app";

const knex = knex_connect({
    client: 'sqlite3',
    connection: {
        filename: ":memory:"
    },
    useNullAsDefault: true
});

async function init() {
    await knex.schema.createTable('blog', function (table) {
        table.increments();
        table.string('title');
        table.text('content');
        table.timestamp('created_at').defaultTo(knex.fn.now());
    });
}
init();


z.addGet("/blogs/", async function allBlog(){
    return await knex('blog')
});


interface NewBlog {
    title: string;
    content: string;
}


z.addPost("/blogs/", async function newBlog(body: NewBlog){
    const blogId = await knex('blog').insert(body);
    return {id: blogId}
});



if (require.main === module) {
    z.run();
}