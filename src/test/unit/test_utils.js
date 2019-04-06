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
var TestUtils_1;
"use strict";
const assert_1 = __importDefault(require("assert"));
const mocha_typescript_1 = require("mocha-typescript");
const utils_1 = require("../../lib/utils");
let TestUtils = TestUtils_1 = class TestUtils {
    testSetUnion() {
        assert_1.default.deepEqual(utils_1.union(new Set([1]), new Set([1])), new Set([1]));
        assert_1.default.deepEqual(utils_1.union(new Set([1]), new Set()), new Set([1]));
        assert_1.default.deepEqual(utils_1.union(new Set([]), new Set([1])), new Set([1]));
        assert_1.default.deepEqual(utils_1.union(new Set([1, 3, 5]), new Set([1, 3, 9])), new Set([1, 3, 5, 9]));
    }
    testSetDiff() {
        assert_1.default.deepEqual(utils_1.difference(new Set([1]), new Set([1])), new Set());
        assert_1.default.deepEqual(utils_1.difference(new Set([1]), new Set()), new Set([1]));
        assert_1.default.deepEqual(utils_1.difference(new Set([]), new Set([1])), new Set());
        assert_1.default.deepEqual(utils_1.difference(new Set([1, 3, 5]), new Set([1, 3])), new Set([5]));
    }
    static _testTopoOrder(graph, topoList) {
        const freeNodeSet = new Set();
        for (const node of topoList) {
            assert_1.default.equal(utils_1.difference(graph[node], freeNodeSet).size, 0);
            freeNodeSet.add(node);
        }
    }
    testTopoSortWithEmptyGraph() {
        assert_1.default.deepEqual(utils_1.toposort(new Map()), []);
        assert_1.default.deepEqual(utils_1.toposort(new Map(), true), []);
    }
    testTopoSort1() {
        const graph = new Map([
            [0, new Set([1, 2])],
            [1, new Set([3])],
            [2, new Set([3])],
            [3, new Set()]
        ]);
        const topoList = utils_1.toposort(graph, false);
        TestUtils_1._testTopoOrder(graph, topoList);
    }
    testTopoSort2() {
        const graph = new Map([
            [0, new Set()],
            [1, new Set([0])],
            [2, new Set([0])],
            [3, new Set([1, 2])]
        ]);
        const topoList = utils_1.toposort(graph, false);
        TestUtils_1._testTopoOrder(graph, topoList);
    }
    testTopoSortWithError() {
        const graph = new Map([
            [1, new Set([2])],
            [2, new Set([1])],
        ]);
        assert_1.default.throws(() => utils_1.toposort(graph, false));
    }
};
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TestUtils.prototype, "testSetUnion", null);
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TestUtils.prototype, "testSetDiff", null);
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TestUtils.prototype, "testTopoSortWithEmptyGraph", null);
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TestUtils.prototype, "testTopoSort1", null);
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TestUtils.prototype, "testTopoSort2", null);
__decorate([
    mocha_typescript_1.test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TestUtils.prototype, "testTopoSortWithError", null);
TestUtils = TestUtils_1 = __decorate([
    mocha_typescript_1.suite
], TestUtils);
