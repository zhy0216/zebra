import assert from "assert";

import { suite, test } from "mocha-typescript";
import { difference, union, toposort } from "../../lib/utils";

@suite
class TestUtils {
    @test
    testSetUnion() {
        assert.deepStrictEqual(union(new Set([1]), new  Set([1])), new Set([1]));
        assert.deepStrictEqual(union(new Set([1]), new  Set()), new Set([1]));
        assert.deepStrictEqual(union(new Set([]), new  Set([1])), new Set([1]));
        assert.deepStrictEqual(union(new Set([1, 3, 5]), new  Set([1, 3, 9])), new Set([1, 3, 5, 9]));
    }

    @test
    testSetDiff() {
        assert.deepStrictEqual(difference(new Set([1]), new  Set([1])), new Set());
        assert.deepStrictEqual(difference(new Set([1]), new  Set()), new Set([1]));
        assert.deepStrictEqual(difference(new Set([]), new  Set([1])), new Set());
        assert.deepStrictEqual(difference(new Set([1, 3, 5]), new  Set([1, 3])), new Set([5]));
    }

    static _testTopoOrder(graph, topoList) {
        const freeNodeSet = new Set();
        for (const node of topoList) {
            assert.strictEqual(difference(graph[node], freeNodeSet).size, 0);
            freeNodeSet.add(node);
        }
    }

    @test
    testTopoSortWithEmptyGraph() {
        assert.deepStrictEqual(toposort(new Map()), []);
        assert.deepStrictEqual(toposort(new Map(), true), []);
    }

    @test
    testTopoSort1() {
        const graph = new Map([
           [0, new Set([1, 2])],
           [1, new Set([3])],
           [2, new Set([3])],
           [3, new Set()]
        ]);
        const topoList = toposort(graph, false);
        TestUtils._testTopoOrder(graph, topoList);
    }

    @test
    testTopoSort2() {
        const graph = new Map([
           [0, new Set()],
           [1, new Set([0])],
           [2, new Set([0])],
           [3, new Set([1, 2])]
        ]);
        const topoList = toposort(graph, false);
        TestUtils._testTopoOrder(graph, topoList);
    }

     @test
    testTopoSortWithError() {
        const graph = new Map([
           [1, new Set([2])],
           [2, new Set([1])],
        ]);
        assert.throws(() => toposort(graph, false));
    }

}
