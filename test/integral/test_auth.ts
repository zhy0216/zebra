import { suite, test, slow, timeout } from "mocha-typescript";
import {Func, Parameter} from "../../lib/func";
import got from "got";
import {z} from "../../lib/app";
import {jwt_sign} from "../../lib/utils";
import assert from "assert";

@suite
class TestAuth {
    @test
    async testAuth() {
        require("../../examples/auth");
        z.run();
        const jwt_token = await jwt_sign({"name": "6789"}, "9876");
        const response = await got.get("http://localhost:8888/hello/", {
            headers: {
                "Authorization": `Bearer ${jwt_token}`
            }
        });
        assert.equal(JSON.parse(response.body), "hello, 6789");
        await z.stop();
    }
}