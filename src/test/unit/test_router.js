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
const router_1 = require("../../lib/router");
const utils_1 = require("../../lib/utils");
let TestRouter = class TestRouter {
    testSingleVarExtractor() {
        const extractor = new router_1.UrlExtractor("/hello/{name}");
        assert_1.default.deepEqual(extractor.extract("/hello/a"), utils_1.objectToMap({ name: "a" }));
        assert_1.default.deepEqual(extractor.extract("/hello/a/b"), utils_1.objectToMap({ name: "a/b" }));
    }
    testMultiVarExtractor() {
        const extractor = new router_1.UrlExtractor("/hello/{name}/{age}");
        assert_1.default.deepEqual(extractor.extract("/hello/a/30"), utils_1.objectToMap({ name: "a", age: "30" }));
    }
};
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TestRouter.prototype, "testSingleVarExtractor", null);
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TestRouter.prototype, "testMultiVarExtractor", null);
TestRouter = __decorate([
    mocha_typescript_1.suite
], TestRouter);
