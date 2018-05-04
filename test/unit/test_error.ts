
import assert from 'assert';

import { suite, test, slow, timeout } from "mocha-typescript";

@suite
class TestError {
    @test
    testErrorExtend(){
        class BaseError extends Error {}
        class Error1 extends BaseError {}

        let error = new Error1();
        assert.ok(error instanceof Error1);
        assert.ok(error instanceof BaseError);

    }
}