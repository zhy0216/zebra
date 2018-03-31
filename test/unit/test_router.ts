// import {getFunctionParameters} from '../lib/utils';

import assert from 'assert';

import { suite, test, slow, timeout } from "mocha-typescript";
import {UrlExtractor} from "../../lib/router";

@suite
class TestRouter {
    @test
    testSingleVarExtractor() {
        let extractor = new UrlExtractor("/hello/{name}");
        assert.deepEqual(extractor.extract("/hello/a"), {"name": "a"});
    }

    @test
    testMultiVarExtractor() {
        let extractor = new UrlExtractor("/hello/{name}/{age}");
        assert.deepEqual(extractor.extract("/hello/a/30"), {"name": "a", "age": "30"});
    }


}
