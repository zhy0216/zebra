import assert from "assert";

import got from "got";
import { suite, test } from "mocha-typescript";
import { z } from "../../lib/app";

@suite
class TestRouter {
    @test
    async testSendStaticFile() {
        z.get("/test", () => {
            return z.sendFile("LICENSE");
        });
        z.run();

        const response = await got.get("http://localhost:8888/test");
        assert.strictEqual(response.body.slice(0, 3), "MIT");
        await z.stop();
    }
}
