import assert from "assert";
import { suite, test } from "mocha-typescript";
import { Func } from "../../lib/func";

@suite
class TestFunc {
    @test
    testFunctionNoParameters() {
        function func() {
        }
        const myFunc = new Func(func);
        assert.strictEqual(myFunc.parameters.length, 0);
    }

    @test
    testFunctionParameters() {
        function func(a: string, b = 1, dd: number) {}
        const myFunc = new Func(func);
        assert.strictEqual(myFunc.parameters.length, 3);
        const argA = myFunc.parameters[0];
        assert.strictEqual(argA.name, "a");
        assert.strictEqual(argA.isRequired, true);
        assert.strictEqual(argA.index, 0);

        const argB = myFunc.parameters[1];
        assert.strictEqual(argB.name, "b");
        assert.strictEqual(argB.isRequired, false);
        assert.strictEqual(argB.index, 1);

        const argC = myFunc.parameters[2];
        assert.strictEqual(argC.name, "dd");
        assert.strictEqual(argC.isRequired, true);
        assert.strictEqual(argC.index, 2);
    }

    @test
    testLambdaParameters() {
        const func = (k= 1, f, c) => {};
        const myFunc = new Func(func);

        const argA = myFunc.parameters[0];
        assert.strictEqual(argA.name, "k");
        assert.strictEqual(argA.isRequired, false);
        assert.strictEqual(argA.index, 0);

        const argB = myFunc.parameters[1];
        assert.strictEqual(argB.name, "f");
        assert.strictEqual(argB.isRequired, true);
        assert.strictEqual(argB.index, 1);

        const argC = myFunc.parameters[2];
        assert.strictEqual(argC.name, "c");
        assert.strictEqual(argC.isRequired, true);
        assert.strictEqual(argC.index, 2);
    }

    @test
    testLambdaParameters2() {
        const func = (k, f, c= "test") => {};
        const myFunc = new Func(func);

        const argA = myFunc.parameters[0];
        assert.strictEqual(argA.name, "k");
        assert.strictEqual(argA.isRequired, true);
        assert.strictEqual(argA.index, 0);

        const argB = myFunc.parameters[1];
        assert.strictEqual(argB.name, "f");
        assert.strictEqual(argB.isRequired, true);
        assert.strictEqual(argB.index, 1);

        const argC = myFunc.parameters[2];
        assert.strictEqual(argC.name, "c");
        assert.strictEqual(argC.isRequired, false);
        assert.strictEqual(argC.index, 2);

    }

}
