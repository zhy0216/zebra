import { suite, test } from "mocha-typescript";
import got from "got";
import {z} from "../../lib/app";
import assert from "assert";

@suite
class TestBlog {
    @test
    async testPost() {
        require("../../examples/blog");
        await z.run();
        // fetch blogs
        const response1 = await got.get("http://localhost:8888/blogs/");
        assert.deepEqual(JSON.parse(response1.body), []);

        const postData = {
                "title": "its1",
                "content": "hello1"
        };

        await got.post("http://localhost:8888/blogs/", {
            body: JSON.stringify(postData)
        });

        const response2 = await got.get("http://localhost:8888/blogs/");
        assert.deepEqual(JSON.parse(response2.body)[0]["title"], postData.title);

        await got.patch("http://localhost:8888/blogs/1/", {
            body: JSON.stringify({
                "title": "iamchanged"
            })
        });

        const response3 = await got.get("http://localhost:8888/blogs/");
        assert.deepEqual(JSON.parse(response3.body)[0]["title"], "iamchanged");

        await got.delete("http://localhost:8888/blogs/1/");
        const response4 = await got.get("http://localhost:8888/blogs/");
        assert.deepEqual(JSON.parse(response4.body), []);

        await z.stop();
    }
}
