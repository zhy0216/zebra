// import {getFunctionParameters} from '../lib/utils';

import assert from 'assert';

import { suite, test, slow, timeout } from "mocha-typescript";
import {difference, union} from "../../lib/utils";

@suite
class TestUtils {
    @test
    testSetUnion() {
        assert.deepEqual(union(new Set([1]), new  Set([1])), new Set([1]));
        assert.deepEqual(union(new Set([1]), new  Set()), new Set([1]));
        assert.deepEqual(union(new Set([]), new  Set([1])), new Set([1]));
        assert.deepEqual(union(new Set([1, 3, 5]), new  Set([1, 3, 9])), new Set([1, 3, 5, 9]));
    }

    @test
    testSetDiff() {
        assert.deepEqual(difference(new Set([1]), new  Set([1])), new Set());
        assert.deepEqual(difference(new Set([1]), new  Set()), new Set([1]));
        assert.deepEqual(difference(new Set([]), new  Set([1])), new Set());
        assert.deepEqual(difference(new Set([1, 3, 5]), new  Set([1, 3])), new Set([5]));
    }


    @test
    testTopoSort1() {


    }

}
