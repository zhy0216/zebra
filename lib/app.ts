import {IncomingMessage, ServerResponse, createServer, Server} from "http";
import {RouterManager, Router} from './router';
import url from 'url';
import {Response} from "./response";
import querystring from 'querystring';
import {isString} from "util";
import {Func} from "./func";
const package_json = require("../package.json");

export interface RegisteredHandler{
    [variable: string]: Function;
}

export class Zebra{
    registeredHandler: RegisteredHandler;
    routerManager: RouterManager;
    server: Server;
    ascii: String = "";
    constructor(){
        this.routerManager = new RouterManager();
        this.registeredHandler = {};
        this.server = createServer();
    }

    addPathPattern(pathPattern: string, methods: Set<string>, handler: Function){
        this.routerManager.add(new Router(methods, pathPattern, handler))
    }


    addGet(path: string, handler: Function){
        this.addPathPattern(path, new Set(["GET"]), handler);
    }

    inject(arg1: Function | string, func?: Function): void{
        if(isString(arg1)) {

        }else{
            this._inject(new Func(arg1));
        }
    }

    _inject(func: Func){

    }

    requestHandlers(req: IncomingMessage, res: ServerResponse){
        const parsedUrl = url.parse(req.url!);
        const requestedMethod = req.method!;
        // parsedUrl.query
        const handler = this.routerManager.get_function(parsedUrl.pathname, requestedMethod);
        const content: object | Response = handler.execute();
        const response = Response.buildFromHandlerResult(content);

        // application/json
        res.writeHead(response.statusCode, response.headers);
        res.write(response.content);
        res.end();
    }


    run(){
        let port = 8888;
        console.log(z.ascii);
        console.log(`running on localhost:${port}`);
        this.server.on("request", ((req, res) => z.requestHandlers(req, res)));
        this.server.listen(port);
    }

    async stop(){
        await this.server.close();
        this.server = createServer();
    }

}


// TODO: make this singleton
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
