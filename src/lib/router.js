"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const func_1 = require("./func");
class UrlExtractor {
    // registerVariable: Set<string>;
    constructor(urlPattern) {
        this.pattern = urlPattern;
        this.metaPattern = new RegExp("^" +
            urlPattern.replace(new RegExp("{(?<var>\\w+)}", "g"), (...params) => {
                const group = params.pop();
                return `(?<${group.var}>.+)`;
            }) +
            "$");
    }
    match(url) {
        return this.metaPattern.test(url);
    }
    extract(url) {
        const r = new Map();
        const data = this.metaPattern.exec(url);
        if (data === null || data.groups === undefined) {
            return r;
        }
        for (const variableName of Object.keys(data.groups)) {
            r.set(variableName, data.groups[variableName]);
        }
        return r;
    }
}
exports.UrlExtractor = UrlExtractor;
class Router {
    constructor(methods, urlPattern, func) {
        this.methods = methods;
        this.urlExtractor = new UrlExtractor(urlPattern);
        this.func = func;
    }
    match(url, method) {
        return this.urlExtractor.match(url) && this.methods.has(method);
    }
    extract(url) {
        return this.urlExtractor.extract(url);
    }
}
exports.Router = Router;
class RouterManager {
    constructor() {
        this.routerList = [];
    }
    add(router) {
        this.routerList.push(router);
    }
    getFunction(url, method = "GET") {
        for (const router of this.routerList) {
            if (router.match(url, method)) {
                return new func_1.Func(router.func, router.extract(url));
            }
        }
        throw new Error(); // a better exception
    }
}
exports.RouterManager = RouterManager;
