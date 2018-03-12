"use strict";
// import {getFunctionParameters} from '../lib/utils';
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
const router_1 = require("../../lib/router");
let TestUnit = class TestUnit {
    testSingleVarExtractor() {
        let extractor = new router_1.UrlExtractor("/hello/{name}");
        assert.deepEqual(extractor.extract("/hello/a"), { "name": "a" });
    }
    testMultiVarExtractor() {
        let extractor = new router_1.UrlExtractor("/hello/{name}/{age}");
        assert.deepEqual(extractor.extract("/hello/a/30"), { "name": "a", "age": "30" });
    }
};
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TestUnit.prototype, "testSingleVarExtractor", null);
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TestUnit.prototype, "testMultiVarExtractor", null);
TestUnit = __decorate([
    mocha_typescript_1.suite
], TestUnit);
