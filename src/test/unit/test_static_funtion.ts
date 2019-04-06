import assert from "assert";

import got from "got";
import { suite, test } from "mocha-typescript";
import { z } from "../../lib/app";

@suite
class TestApp {
    @test
    async testStaticFunction() {
        z.static("/static", ".");
        z.run();

        const response = await got.get("http://localhost:8888/static/LICENSE");
        assert.strictEqual(response.body.slice(0, 3), "MIT");
        await z.stop();
    }
}
