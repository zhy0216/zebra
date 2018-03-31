
import * as assert from 'assert';

import { suite, test, slow, timeout } from "mocha-typescript";
import {Func, Parameter} from "../../lib/func";

@suite
class TestFunc {
    @test
    testFunctionParameters() {
        function func(a: string, b: number =1, dd: number){}
        const myFunc = new Func(func);
        assert.equal(myFunc.parameters.length, 3);
        const argA = myFunc.parameters[0];
        assert.equal(argA.name, "a");
        assert.equal(argA.isRequired, true);
        assert.equal(argA.index, 0);

        const argB = myFunc.parameters[1];
        assert.equal(argB.name, "b");
        assert.equal(argB.isRequired, false);
        assert.equal(argB.index, 1);

        const argC = myFunc.parameters[2];
        assert.equal(argC.name, "dd");
        assert.equal(argC.isRequired, true);
        assert.equal(argC.index, 2);
    }

    @test
    testLambdaParameters() {
        const func = (k=1, f, c) => {};
        const myFunc = new Func(func);

        const argA = myFunc.parameters[0];
        assert.equal(argA.name, "k");
        assert.equal(argA.isRequired, false);
        assert.equal(argA.index, 0);

        const argB = myFunc.parameters[1];
        assert.equal(argB.name, "f");
        assert.equal(argB.isRequired, true);
        assert.equal(argB.index, 1);

        const argC = myFunc.parameters[2];
        assert.equal(argC.name, "c");
        assert.equal(argC.isRequired, true);
        assert.equal(argC.index, 2);
    }

    @test
    testLambdaParameters2() {
        const func = (k, f, c="test") => {};
        const myFunc = new Func(func);

        const argA = myFunc.parameters[0];
        assert.equal(argA.name, "k");
        assert.equal(argA.isRequired, true);
        assert.equal(argA.index, 0);

        const argB = myFunc.parameters[1];
        assert.equal(argB.name, "f");
        assert.equal(argB.isRequired, true);
        assert.equal(argB.index, 1);

        const argC = myFunc.parameters[2];
        assert.equal(argC.name, "c");
        assert.equal(argC.isRequired, false);
        assert.equal(argC.index, 2);

    }

}
