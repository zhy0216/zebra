import {IncomingMessage, ServerResponse, createServer, Server} from "http";
import {RouterManager, Router} from './router';
import url from 'url';
import {Response} from "./response";
import querystring from 'querystring';
import {isString} from "util";
import {Func} from "./func";
import {chain} from "./utils";
import {isAbsolute} from "path";
const package_json = require("../package.json");

interface ZebraEvent {
    beforeRun: Array<Function>;
    beforeStop: Array<Function>;
}

export class Zebra{
    // registeredHandler: Map<string, Function>;
    routerManager: RouterManager;
    server: Server;
    ascii: String = "";
    lazyEnv: Map<string, Func>;
    events: ZebraEvent;
    constructor(){
        this.routerManager = new RouterManager();
        // this.registeredHandler = new Map();
        this.server = createServer();
        this.lazyEnv = new Map<string, Func>();
        this.events = {beforeRun: [], beforeStop: []};
    }

    addBeforeRun(func: Function){
        this.events.beforeRun.push(func);
    }

    addBeforeStop(func: Function){
        this.events.beforeStop.push(func);
    }

    addPathPattern(pathPattern: string, methods: Set<string>, handler: Function){
        this.routerManager.add(new Router(methods, pathPattern, handler))
    }


    addGet(path: string, handler: Function){
        this.addPathPattern(path, new Set(["GET"]), handler);
    }

    addPost(path: string, handler: Function){
        this.addPathPattern(path, new Set(["POST"]), handler);
    }

    addDelete(path: string, handler: Function){
        this.addPathPattern(path, new Set(["Delete"]), handler);
    }

    addPatch(path: string, handler: Function){
        this.addPathPattern(path, new Set(["PATCH"]), handler);
    }



    inject(arg1: Function | string, func?: Function): void{
        if(isString(arg1)) {
            this.lazyEnv.set(arg1, new Func(func));
        }else{
            this.lazyEnv.set(arg1.name, new Func(arg1));
        }
    }

    async requestHandlers(req: IncomingMessage, res: ServerResponse){

        const body = new Promise(function (resolve, reject) {
            const chunks: Array<Buffer> = [];

            req.on('data', chunk => {
                if(Buffer.isBuffer(chunk)){
                    chunks.push(chunk)
                }else{
                    const buffer = Buffer.from(chunk);
                    chunks.push(buffer);
                }
            });

            req.on('end', () => {
                if(chunks.length === 0){
                    return resolve();
                }
                const data = JSON.parse(Buffer.concat(chunks).toString());
                resolve(data);
            });
        });


        const parsedUrl = url.parse(req.url!);
        const requestedMethod = req.method!;
        // parsedUrl.query
        const handler = this.routerManager.get_function(parsedUrl.pathname, requestedMethod);
        const queryMap = querystring.parse(parsedUrl.query || "") || {};

        const extraClosure = new Map<string, any>(chain([
            ["req", req],
            ["res", res],
            ["body", await body]
        ], Object.entries(queryMap)));


        let handlerPromise: Promise<object | Response> = Promise.resolve(handler.execute(extraClosure, this.lazyEnv));
        const response = Response.buildFromHandlerResult(await handlerPromise);

        // application/json
        res.writeHead(response.statusCode, response.headers);
        res.write(response.content);
        res.end();
    }

    async run(){
        const self = this;
        await Promise.all(Object.values(this.events.beforeRun).map(func => Promise.resolve(func())));

        let port = 8888;
        console.log(z.ascii);
        console.log(`running on localhost: ${port}`);
        self.server.on("request", (async (req, res) => await z.requestHandlers(req, res)));
        self.server.listen(port);
    }

    async stop(){
        for(const func of this.events.beforeStop){
            func();
        }
        await this.server.close();
        this.server = createServer();
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
       VERSION: ${package_json.version}
########################################       
       
Copyright (C) 2018 Yang
Under the MIT License
`;
