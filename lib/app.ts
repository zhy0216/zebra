import {IncomingMessage, ServerResponse, createServer} from "http";
import {RouterManager, Router} from './router';
import url from 'url';
import {Response} from "./response";
import querystring from 'querystring';

export interface RegisteredHandler{
    [variable: string]: Function;
}

export class Zebra{
    registeredHandler: RegisteredHandler;
    routerManager: RouterManager;
    constructor(){
        this.routerManager = new RouterManager();
        this.registeredHandler = {};
    }

    addPathPattern(pathPattern: string, methods: Set<string>, handler: Function){
        this.routerManager.add(new Router(methods, pathPattern, handler))
    }


    addGet(path: string, handler: Function){
        this.addPathPattern(path, new Set(["GET"]), handler);
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
        console.log(`running on localhost:${port}`);
        createServer((req, res) => z.requestHandlers(req, res)).listen(port);
    }

}


// TODO: make this singleton
export const z = new Zebra();
