import knex_connect from 'knex';
import {z} from "../lib/app";

const knex = knex_connect({
    client: 'sqlite3',
    connection: {
        filename: "sqlite:///:memory:"
    },
    pool: {
        afterCreate: function (conn, done) {
          knex.createTable('blog', function (table) {
              table.increments();
              table.string('title');
              table.text('content');
              table.timestamp('created_at').defaultTo(knex.fn.now());
          })
        }
    }
});


z.addGet("/blogs/", function allBlog(){
    return knex('blog')
});


interface NewBlog {
    title: string;
    content: string;
}


z.addPost("/blogs/", async function newBlog(blog: NewBlog){
    const blogId = await knex('blog').returning('id').insert(blog);
    return {id: blogId}
});



if (require.main === module) {
    z.run();
}