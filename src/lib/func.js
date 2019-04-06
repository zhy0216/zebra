"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("./utils");
class Parameter {
    constructor(name, isRequired, index) {
        this.name = name;
        this.isRequired = isRequired;
        this.index = index;
    }
}
exports.Parameter = Parameter;
class Func {
    constructor(func, closure, lazyClosure) {
        this.func = func;
        this.name = undefined;
        this.closure = closure || new Map();
        this.lazyClosure = lazyClosure || new Map();
        this.parameters = [];
        this._parseFunc(func);
    }
    _parseFunc(f) {
        // parse name
        if (f.name !== "anonymous" || f.name !== "") {
            this.name = f.name.split(" ").pop();
        }
        // parse parameter
        const fnStr = f.toString().replace(Func.STRIP_COMMENTS, "");
        const argsStr = fnStr.slice(fnStr.indexOf("(") + 1, fnStr.indexOf(")"));
        if (argsStr.length === 0) {
            return;
        }
        const argsList = argsStr.replace(/ /g, "").split(",");
        for (const index in argsList) {
            const argName = argsList[index];
            const equationIndex = argName.indexOf("=");
            if (equationIndex === -1) {
                this.parameters.push(new Parameter(argName, true, index));
            }
            else {
                this.parameters.push(new Parameter(argName.slice(0, equationIndex), false, index));
            }
        }
    }
    async _execute(extraClosure = new Map(), extraLazyClosure = new Map()) {
        const closure = new Map(utils_1.chain(this.closure, extraClosure));
        const lazyClosure = new Map(utils_1.chain(this.lazyClosure, extraLazyClosure));
        const args = { length: this.parameters.length };
        for (const parameter of this.parameters) {
            const argName = parameter.name;
            if (parameter.isRequired && !closure.has(argName) && !lazyClosure.has(argName)) {
                throw Error(`function ${this.name} does not have ${argName}`);
            }
            let value = closure.get(argName);
            if (lazyClosure.has(argName)) {
                const lazyFunc = lazyClosure.get(argName);
                value = await Promise.resolve(lazyFunc._execute(extraClosure, extraLazyClosure));
            }
            // only search in closure
            args[parameter.index] = value;
        }
        return Promise.resolve(this.func.apply(undefined, args));
    }
    async execute(extraClosure = new Map(), extraLazyClosure = new Map()) {
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/apply
        // use a custom object like { 'length': 2, '0': 'eat', '1': 'bananas' }
        const lazyClosure = new Map(utils_1.chain(this.lazyClosure, extraLazyClosure));
        const reorderParameterMap = new Map();
        const constraintGraph = new Map();
        for (const [name, func] of lazyClosure) {
            constraintGraph[name] = new Set(func.parameters.filter(p => p.isRequired));
        }
        for (const name of utils_1.toposort(constraintGraph, true)) {
            const parameter = this.parameters.find(p => p.name === name);
            if (parameter !== undefined) {
                reorderParameterMap.set(name.toString(), parameter);
            }
        }
        for (const parameter of this.parameters) {
            if (!reorderParameterMap.has(parameter.name)) {
                reorderParameterMap.set(parameter.name, parameter);
            }
        }
        this.parameters = Array.from(reorderParameterMap.values());
        const r = await this._execute(extraClosure, extraLazyClosure);
        // some exit logic here
        return r;
    }
}
Func.STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
exports.Func = Func;
