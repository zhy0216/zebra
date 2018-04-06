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
        const data = new Map([
            ["name", "it"]
        ]);

        const func = new Func((name: string) => `hello, ${name}`, data);
        assert.equal(func.execute(), "hello, it");
    }

    @test
    async testSimpleInjector2() {
        const data = new Map([
            ["name", "it"]
        ]);
        const func = new Func((name: string) => `hello, ${name}`);
        assert.equal(func.execute(data), "hello, it");
    }

    @test
    async testLazyInjector() {
        const lazyEnv = new Map([
            ["name", new Func(function name(){return "it"})]
        ]);
        const func = new Func((name: string) => `hello, ${name}`);
        assert.equal(func.execute(undefined, lazyEnv), "hello, it");
    }

}
