import assert from "assert";

import { suite, test } from "mocha-typescript";
import { Func } from "../../lib/func";

@suite
class TestInject {

    @test
    async testSimpleInjector1() {
        const data = new Map([
            ["name", "it"]
        ]);

        const func = new Func((name: string) => `hello, ${name}`, data);
        assert.strictEqual(await func.execute(), "hello, it");
    }

    @test
    async testSimpleInjector2() {
        const data = new Map([
            ["name", "it"]
        ]);
        const func = new Func((name: string) => `hello, ${name}`);
        assert.strictEqual(await func.execute(data), "hello, it");
    }

    @test
    async testLazyInjector() {
        const lazyEnv = new Map([
            ["name", new Func(function name() {return "it"; })]
        ]);
        const func = new Func((name: string) => `hello, ${name}`);
        assert.strictEqual(await func.execute(undefined, lazyEnv), "hello, it");
    }

    @test
    async testInjectorWithRefer() {
        const lazyEnv = new Map([
            ["name", new Func(function name() {return "it"; })],
            ["anotherName", new Func(function anotherName(name) {return name; })]
        ]);
        const func = new Func((anotherName: string) => `hello, ${anotherName}`);
        assert.strictEqual(await func.execute(new Map<string, any>(), lazyEnv), "hello, it");
    }
}
