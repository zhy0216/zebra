import assert from 'assert';

import { suite, test, slow, timeout } from "mocha-typescript";
import {UrlExtractor} from "../../lib/router";
import {z} from "../../lib/app";
import {Func} from "../../lib/func";
import got from "got";

@suite
class TestInject {
    @test
    async testSimpleInjector1() {
        const func = new Func((name: string) => `hello, ${name}`, {"name": "it"});
        assert.equal(func.execute(), "hello, it");
    }

    @test
    async testSimpleInjector2() {
        const func = new Func((name: string) => `hello, ${name}`);
        assert.equal(func.execute({"name": "it"}), "hello, it");
    }

}
