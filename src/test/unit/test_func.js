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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const mocha_typescript_1 = require("mocha-typescript");
const func_1 = require("../../lib/func");
let TestFunc = class TestFunc {
    testFunctionNoParameters() {
        function func() {
        }
        const myFunc = new func_1.Func(func);
        assert_1.default.equal(myFunc.parameters.length, 0);
    }
    testFunctionParameters() {
        function func(a, b = 1, dd) { }
        const myFunc = new func_1.Func(func);
        assert_1.default.equal(myFunc.parameters.length, 3);
        const argA = myFunc.parameters[0];
        assert_1.default.equal(argA.name, "a");
        assert_1.default.equal(argA.isRequired, true);
        assert_1.default.equal(argA.index, 0);
        const argB = myFunc.parameters[1];
        assert_1.default.equal(argB.name, "b");
        assert_1.default.equal(argB.isRequired, false);
        assert_1.default.equal(argB.index, 1);
        const argC = myFunc.parameters[2];
        assert_1.default.equal(argC.name, "dd");
        assert_1.default.equal(argC.isRequired, true);
        assert_1.default.equal(argC.index, 2);
    }
    testLambdaParameters() {
        const func = (k = 1, f, c) => { };
        const myFunc = new func_1.Func(func);
        const argA = myFunc.parameters[0];
        assert_1.default.equal(argA.name, "k");
        assert_1.default.equal(argA.isRequired, false);
        assert_1.default.equal(argA.index, 0);
        const argB = myFunc.parameters[1];
        assert_1.default.equal(argB.name, "f");
        assert_1.default.equal(argB.isRequired, true);
        assert_1.default.equal(argB.index, 1);
        const argC = myFunc.parameters[2];
        assert_1.default.equal(argC.name, "c");
        assert_1.default.equal(argC.isRequired, true);
        assert_1.default.equal(argC.index, 2);
    }
    testLambdaParameters2() {
        const func = (k, f, c = "test") => { };
        const myFunc = new func_1.Func(func);
        const argA = myFunc.parameters[0];
        assert_1.default.equal(argA.name, "k");
        assert_1.default.equal(argA.isRequired, true);
        assert_1.default.equal(argA.index, 0);
        const argB = myFunc.parameters[1];
        assert_1.default.equal(argB.name, "f");
        assert_1.default.equal(argB.isRequired, true);
        assert_1.default.equal(argB.index, 1);
        const argC = myFunc.parameters[2];
        assert_1.default.equal(argC.name, "c");
        assert_1.default.equal(argC.isRequired, false);
        assert_1.default.equal(argC.index, 2);
    }
};
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TestFunc.prototype, "testFunctionNoParameters", null);
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
