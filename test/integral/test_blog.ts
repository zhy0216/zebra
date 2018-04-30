import { suite, test, slow, timeout } from "mocha-typescript";
import {Func, Parameter} from "../../lib/func";
import got from "got";
import {z} from "../../lib/app";
import assert from "assert";

@suite
class TestBlog {
    @test
    async testPost() {
        require("../../examples/blog");
        z.run();
        const response = await got.get("http://localhost:8888/blogs/");
        assert.deepEqual(JSON.parse(response.body), []);
        await z.stop();

    }
}