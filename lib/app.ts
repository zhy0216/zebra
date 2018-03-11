import {IncomingMessage, ServerResponse, createServer} from "http";
import {RouterManager, Router} from './router';
import url from 'url';
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
        const content = handler();

        // application/json
        res.writeHead(200, {'Content-type': 'text/html'});
        res.write(content);
        res.end();
    }

    run(){
        createServer((req, res) => z.requestHandlers(req, res)).listen(8888);
    }

}


// TODO: make this singleton
export const z = new Zebra();
