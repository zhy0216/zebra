// import {getFunctionParameters} from '../lib/utils';

import * as assert from 'assert';

import { suite, test, slow, timeout } from "mocha-typescript";
import {UrlExtractor} from "../lib/router";

@suite
class TestUnit {
    @test
    testSingleVarExtractor() {
        let extractor = new UrlExtractor("/hello/{name}");
        assert.deepEqual(extractor.extract("/hello/a"), {"name": "a"});
    }

}
