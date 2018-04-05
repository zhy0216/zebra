// import {getFunctionParameters} from '../lib/utils';

import assert from 'assert';

import { suite, test, slow, timeout } from "mocha-typescript";
import {UrlExtractor} from "../../lib/router";
import {objectToMap} from "../../lib/utils";

@suite
class TestRouter {
    @test
    testSingleVarExtractor() {
        let extractor = new UrlExtractor("/hello/{name}");
        assert.deepEqual(extractor.extract("/hello/a"), objectToMap({"name": "a"}));
    }

    @test
    testMultiVarExtractor() {
        let extractor = new UrlExtractor("/hello/{name}/{age}");
        assert.deepEqual(extractor.extract("/hello/a/30"), objectToMap({"name": "a", "age": "30"}));
    }


}
