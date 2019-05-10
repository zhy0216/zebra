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
const mocha_typescript_1 = require("mocha-typescript");
const got_1 = __importDefault(require("got"));
const app_1 = require("../../lib/app");
const assert_1 = __importDefault(require("assert"));
let TestHello = class TestHello {
    async testHello() {
        require("../../examples/auth");
        require("../../examples/hello");
        app_1.z.run();
        const response = await got_1.default.get("http://localhost:8888/hello/world");
        assert_1.default.equal(JSON.parse(response.body), "hello, world");
        await app_1.z.stop();
    }
};
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], TestHello.prototype, "testHello", null);
TestHello = __decorate([
    mocha_typescript_1.suite
], TestHello);
