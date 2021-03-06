import { suite, test } from "mocha-typescript";
import got from "got";
import { z } from "../../lib/app";
import assert from "assert";

@suite
class TestHello {
    @test
    async testHello() {
        require("../../examples/auth");
        require("../../examples/hello");
        z.run();
        const response = await got.get("http://localhost:8888/hello/world");
        assert.equal(JSON.parse(response.body), "hello, world");
        await z.stop();
    }
}
