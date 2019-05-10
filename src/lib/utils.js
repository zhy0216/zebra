"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function objectToMap(obj) {
    return new Map(Object.entries(obj));
}
exports.objectToMap = objectToMap;
function* chain(...iterators) {
    for (const iterator of iterators) {
        for (const x of iterator) {
            yield x;
        }
    }
}
exports.chain = chain;
function union(set1, set2) {
    const unionSet = new Set(set1);
    for (const elem of set2) {
        unionSet.add(elem);
    }
    return unionSet;
}
exports.union = union;
function difference(set1, set2) {
    const differenceSet = new Set(set1);
    for (const elem of set2) {
        differenceSet.delete(elem);
    }
    return differenceSet;
}
exports.difference = difference;
function toposort(graph, flatten = false) {
    const r = [];
    const freeNodeSet = new Set();
    graph = new Map(graph); // make sure the original graph does not change
    while (true) {
        const visitList = [];
        for (const [node, nodeSet] of graph) {
            if (difference(nodeSet, freeNodeSet).size === 0) {
                visitList.push(node);
            }
        }
        for (const node of visitList) {
            graph.delete(node);
            freeNodeSet.add(node);
        }
        if (visitList.length === 0) {
            break;
        }
        r.push(visitList);
    }
    if (graph.size !== 0) {
        throw Error;
    }
    if (flatten) {
        r.reduce((acc, val) => acc.concat(val), []);
        return r;
    }
    return r;
}
exports.toposort = toposort;
async function jwtSign(data, secret) {
    return new Promise((resolve) => {
        jsonwebtoken_1.default.sign(data, secret, { algorithm: "HS256" }, (err, token) => {
            resolve(token);
        });
    });
}
exports.jwtSign = jwtSign;
async function jwtDecode(token, secret) {
    return new Promise((resolve) => {
        jsonwebtoken_1.default.verify(token, secret, (err, decoded) => {
            resolve(decoded);
        });
    });
}
exports.jwtDecode = jwtDecode;
