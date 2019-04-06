"use strict";
function __export(m) {
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = require("http");
const url_1 = __importDefault(require("url"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const router_1 = require("./router");
const response_1 = require("./response");
const querystring_1 = __importDefault(require("querystring"));
const func_1 = require("./func");
const utils_1 = require("./utils");
const mime_1 = require("./mime");
const packageJson = require("../package.json");
class Zebra {
    constructor() {
        this.ascii = "";
        this.routerManager = new router_1.RouterManager();
        // this.registeredHandler = new Map();
        this.server = http_1.createServer();
        this.lazyEnv = new Map();
        this.events = { beforeRun: [], beforeStop: [] };
    }
    addBeforeRun(func) {
        this.events.beforeRun.push(func);
    }
    addBeforeStop(func) {
        this.events.beforeStop.push(func);
    }
    addPathPattern(pathPattern, methods, handler) {
        this.routerManager.add(new router_1.Router(methods, pathPattern, handler));
    }
    addGet(path, handler) {
        this.addPathPattern(path, new Set(["GET"]), handler);
    }
    addPost(path, handler) {
        this.addPathPattern(path, new Set(["POST"]), handler);
    }
    addDelete(path, handler) {
        this.addPathPattern(path, new Set(["DELETE"]), handler);
    }
    addPatch(path, handler) {
        this.addPathPattern(path, new Set(["PATCH"]), handler);
    }
    static(routPath, filepath) {
        this.addGet(routPath + "/{filename}", (filename) => {
            return this.sendFile(path_1.default.join(filepath, filename));
        });
    }
    inject(arg1, func) {
        if (typeof arg1 === "string") {
            this.lazyEnv.set(arg1, new func_1.Func(func));
        }
        else {
            this.lazyEnv.set(arg1.name, new func_1.Func(arg1));
        }
    }
    async sendFile(filename) {
        return new Promise((resolve) => {
            fs_1.default.readFile(filename, (err, data) => {
                const ext = path_1.default.parse(filename).ext;
                const contentType = mime_1.getMemeType[ext] || "text/plain";
                return resolve(new response_1.Response(data, { "Content-Type": contentType }));
            });
        });
    }
    async getRequestBody(req) {
        return new Promise((resolve) => {
            const chunks = [];
            req.on("data", chunk => {
                if (Buffer.isBuffer(chunk)) {
                    chunks.push(chunk);
                }
                else {
                    const buffer = Buffer.from(chunk);
                    chunks.push(buffer);
                }
            });
            req.on("end", () => {
                if (chunks.length === 0) {
                    return resolve();
                }
                const data = JSON.parse(Buffer.concat(chunks).toString());
                resolve(data);
            });
        });
    }
    async requestHandlers(req, res) {
        const body = await this.getRequestBody(req);
        const parsedUrl = url_1.default.parse(req.url);
        const requestedMethod = req.method;
        // parsedUrl.query
        const handler = this.routerManager.getFunction(parsedUrl.pathname, requestedMethod);
        const queryMap = querystring_1.default.parse(parsedUrl.query || "") || {};
        const extraClosure = new Map(utils_1.chain([
            ["req", req],
            ["res", res],
            ["body", body]
        ], Object.entries(queryMap)));
        try {
            const response = response_1.Response.buildFromHandlerResult(await handler.execute(extraClosure, this.lazyEnv));
            res.writeHead(response.statusCode, response.headers);
            res.write(response.content);
            res.end();
        }
        catch (e) { // better handler
            res.writeHead(400);
            res.write(e.toString());
            res.end();
        }
        // application/json
    }
    async run(port = 8888) {
        await Promise.all(Object.values(this.events.beforeRun).map(func => Promise.resolve(func())));
        console.log(exports.z.ascii);
        console.log(`running on localhost: ${port}`);
        this.server.on("request", (async (req, res) => exports.z.requestHandlers(req, res)));
        this.server.listen(port);
    }
    async stop() {
        for (const func of this.events.beforeStop) {
            func();
        }
        await this.server.close();
        this.server = http_1.createServer();
        this.events = { beforeRun: [], beforeStop: [] };
    }
}
exports.Zebra = Zebra;
// TODO: make this singleton?
exports.z = new Zebra();
exports.z.ascii = `
########################################
███████╗███████╗██████╗ ██████╗  █████╗ 
╚══███╔╝██╔════╝██╔══██╗██╔══██╗██╔══██╗
  ███╔╝ █████╗  ██████╔╝██████╔╝███████║
 ███╔╝  ██╔══╝  ██╔══██╗██╔══██╗██╔══██║
███████╗███████╗██████╔╝██║  ██║██║  ██║
╚══════╝╚══════╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝
    WEB FRAMEWORK FOR LAZY PEOPLE
       VERSION: ${packageJson.version}
########################################       
       
Copyright (C) 2018 Yang
Under the MIT License
`;
__export(require("./func"));
__export(require("./mime"));
__export(require("./response"));
__export(require("./router"));
__export(require("./utils"));
