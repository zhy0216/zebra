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
let TestInject = class TestInject {
    async testSimpleInjector1() {
        const data = new Map([
            ["name", "it"]
        ]);
        const func = new func_1.Func((name) => `hello, ${name}`, data);
        assert_1.default.equal(await func.execute(), "hello, it");
    }
    async testSimpleInjector2() {
        const data = new Map([
            ["name", "it"]
        ]);
        const func = new func_1.Func((name) => `hello, ${name}`);
        assert_1.default.equal(await func.execute(data), "hello, it");
    }
    async testLazyInjector() {
        const lazyEnv = new Map([
            ["name", new func_1.Func(function name() { return "it"; })]
        ]);
        const func = new func_1.Func((name) => `hello, ${name}`);
        assert_1.default.equal(await func.execute(undefined, lazyEnv), "hello, it");
    }
    async testInjectorWithRefer() {
        const lazyEnv = new Map([
            ["name", new func_1.Func(function name() { return "it"; })],
            ["anotherName", new func_1.Func(function anotherName(name) { return name; })]
        ]);
        const func = new func_1.Func((anotherName) => `hello, ${anotherName}`);
        assert_1.default.equal(await func.execute(new Map(), lazyEnv), "hello, it");
    }
};
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], TestInject.prototype, "testSimpleInjector1", null);
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], TestInject.prototype, "testSimpleInjector2", null);
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], TestInject.prototype, "testLazyInjector", null);
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], TestInject.prototype, "testInjectorWithRefer", null);
TestInject = __decorate([
    mocha_typescript_1.suite
], TestInject);
