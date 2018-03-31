"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
}
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const mocha_typescript_1 = require("mocha-typescript");
const func_1 = require("../../lib/func");
let TestFunc = class TestFunc {
    testFunctionParameters() {
        function func(a, b = 1, dd) { }
        const myFunc = new func_1.Func(func);
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
    testLambdaParameters() {
        const func = (k = 1, f, c) => { };
        const myFunc = new func_1.Func(func);
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
    testLambdaParameters2() {
        const func = (k, f, c = "test") => { };
        const myFunc = new func_1.Func(func);
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
};
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TestFunc.prototype, "testFunctionParameters", null);
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TestFunc.prototype, "testLambdaParameters", null);
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TestFunc.prototype, "testLambdaParameters2", null);
TestFunc = __decorate([
    mocha_typescript_1.suite
], TestFunc);
