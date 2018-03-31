// import {getFunctionParameters} from '../lib/utils';

import * as assert from 'assert';

import { suite, test, slow, timeout } from "mocha-typescript";
import {UrlExtractor} from "../../lib/router";
import {z} from "../../lib/app";

@suite
class TestInject {
    @test
    async testSimpleInjector() {
        z.addGet("/test-simple-inject", (name: string) => `hello, ${name}`);
        z.inject(function name(){return "it"});
        z.run();
        const response = await got.get("http://localhost:8888/test-simple-inject");
        assert.equal(JSON.parse(response.body), "hello, it");
        await z.stop();
    }



}
