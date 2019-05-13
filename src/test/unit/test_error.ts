
import assert from "assert";

import { suite, test } from "mocha-typescript";

@suite
class TestError {
    @test
    testErrorExtend() {
        class BaseError extends Error {}
        class Error1 extends BaseError {}

        const error = new Error1();
        assert.ok(error instanceof Error1);
        assert.ok(error instanceof BaseError);

    }
}
