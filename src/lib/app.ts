import { IncomingMessage, ServerResponse, createServer, Server } from "http";
import url from "url";
import path from "path";
import fs from "fs";

import { RouterManager, Router } from "./router";
import { Response } from "./response";
import querystring from "querystring";
import { Func } from "./func";
import { chain, objectToMap } from "./utils";
import { getMemeType } from "./mime";
const packageJson = require("../../package.json");

type EventFunc = (() => void | Promise<void>);

interface ZebraEvent {
    beforeRun: EventFunc[];
    beforeStop: EventFunc[];
}

export class Zebra {
    // registeredHandler: Map<string, Function>;
    routerManager: RouterManager;
    server: Server;
    ascii = "";
    lazyEnv: Map<string, Func>;
    events: ZebraEvent;
    constructor() {
        this.routerManager = new RouterManager();
        // this.registeredHandler = new Map();
        this.server = createServer();
        this.lazyEnv = new Map<string, Func>();
        this.events = {beforeRun: [], beforeStop: []};
    }

    addBeforeRun(func: EventFunc) {
        this.events.beforeRun.push(func);
    }

    addBeforeStop(func: EventFunc) {
        this.events.beforeStop.push(func);
    }

    addPathPattern(pathPattern: string, methods: Set<string>, handler: Function) {
        this.routerManager.add(new Router(methods, pathPattern, handler));
    }

    addGet(path: string, handler: Function) {
        this.addPathPattern(path, new Set(["GET"]), handler);
    }

    addPost(path: string, handler: Function) {
        this.addPathPattern(path, new Set(["POST"]), handler);
    }

    addDelete(path: string, handler: Function) {
        this.addPathPattern(path, new Set(["DELETE"]), handler);
    }

    addPatch(path: string, handler: Function) {
        this.addPathPattern(path, new Set(["PATCH"]), handler);
    }

    static(routPath: string, filepath: string) {
        this.addGet(routPath + "/{filename}", (filename) => {
            return this.sendFile(path.join(filepath, filename));
        });
    }

    inject(arg1: Function | string, func?: Function): void {
        if (typeof arg1 === "string") {
            this.lazyEnv.set(arg1, new Func(func));
        } else {
            this.lazyEnv.set(arg1.name, new Func(arg1));
        }
    }

    async sendFile(filename: string): Promise<Response> {
        return new Promise<Response>((resolve) => {
            fs.readFile(filename, (err, data) => { // TODO: handle error
                const ext = path.parse(filename).ext;
                const contentType = getMemeType[ext] || "text/plain";
                return resolve(new Response(data, {"Content-Type": contentType}));
            });
        });
    }

    async getRequestBody(req: IncomingMessage) {
        return new Promise((resolve) => {
            const chunks: Buffer[] = [];

            req.on("data", chunk => {
                if (Buffer.isBuffer(chunk)) {
                    chunks.push(chunk);
                } else {
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

    async requestHandlers(req: IncomingMessage, res: ServerResponse) {
        const body = await this.getRequestBody(req);

        const parsedUrl = url.parse(req.url!);
        const requestedMethod = req.method!;
        // parsedUrl.query
        const handler = this.routerManager.getFunction(parsedUrl.pathname, requestedMethod);
        const queryMap = querystring.parse(parsedUrl.query || "") || {};

        const extraClosure = new Map<string, any>(chain([
            ["req", req],
            ["res", res],
            ["body", body]
        ], Object.entries(queryMap)));

        try {
            const response = Response.buildFromHandlerResult(await handler.execute(extraClosure, this.lazyEnv));
            res.writeHead(response.statusCode, response.headers);
            res.write(response.content);
            res.end();
        } catch (e) { // better handler
            res.writeHead(400);
            res.write(e.toString());
            res.end();
        }


        // application/json

    }

    async run(port = 8888) {
        await Promise.all(Object.values(this.events.beforeRun).map(func => Promise.resolve(func())));

        console.log(z.ascii);
        console.log(`running on localhost: ${port}`);
        this.server.on("request", (async (req, res) => z.requestHandlers(req, res)));
        this.server.listen(port);
    }

    async stop() {
        for (const func of this.events.beforeStop) {
            func();
        }
        await this.server.close();
        this.server = createServer();
        this.events = {beforeRun: [], beforeStop: []};
    }

}

// TODO: make this singleton?
export const z = new Zebra();
z.ascii = `
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


export * from "./func";
export * from "./mime";
export * from "./response";
export * from "./router";
export * from "./utils";
