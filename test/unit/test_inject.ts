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
        assert.equal(await func.execute(), "hello, it");
    }

    @test
    async testSimpleInjector2() {
        const data = new Map([
            ["name", "it"]
        ]);
        const func = new Func((name: string) => `hello, ${name}`);
        assert.equal(await func.execute(data), "hello, it");
    }

    @test
    async testLazyInjector() {
        const lazyEnv = new Map([
            ["name", new Func(function name(){return "it"})]
        ]);
        const func = new Func((name: string) => `hello, ${name}`);
        assert.equal(await func.execute(undefined, lazyEnv), "hello, it");
    }

    @test
    async testInjectorWithRefer() {
        const lazyEnv = new Map([
            ["name", new Func(function name(){return "it"})],
            ["another_name", new Func(function another_name(name){return name})]
        ]);
        const func = new Func((another_name: string) => `hello, ${another_name}`);
        assert.equal(await func.execute(null, lazyEnv), "hello, it");
    }

}
