import { suite, test } from "mocha-typescript";
import got from "got";
import { z } from "../../lib/app";
import { jwtSign } from "../../lib/utils";
import assert from "assert";

@suite
class TestAuth {
    @test
    async testAuth() {
        require("../../examples/auth");
        z.run();
        const jwtToken = await jwtSign({name: "6789"}, "9876");
        const response = await got.get("http://localhost:8888/hello/", {
            headers: {
                Authorization: `Bearer ${jwtToken}`
            }
        });
        assert.equal(JSON.parse(response.body), "hello, 6789");
        await z.stop();
    }
}
