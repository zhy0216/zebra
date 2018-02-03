// import {getFunctionParameters} from '../lib/utils';

import * as assert from 'assert';

import { suite, test, slow, timeout } from "mocha-typescript";
import {getFunctionParameters} from "../lib/utils";

@suite
class TestUnit {
    @test
    testGetFunctionParameters() {
        function func1(a: string, b: number, dd: number){}
        const func2 = (k, f, c) => {};
        const func3 = (k, f, c="test") => {};
        assert.deepEqual(getFunctionParameters(func1), ["a", "b", "dd"]);
        assert.deepEqual(getFunctionParameters(func2), ["k", "f", "c"]);
        assert.deepEqual(getFunctionParameters(func3), ["k", "f", "c"]);
    }
}
