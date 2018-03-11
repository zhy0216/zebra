import {IncomingMessage, ServerResponse, createServer} from "http";
import {RouterManager, Router} from './router';


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

    addPathPattern(pathPattern: string, method: string, handler: Function){
        this.routerManager.add(new Router(method, pathPattern, handler))
    }


    addGet(path: string, handler: Function){
        this.addPathPattern(path, "GET", handler);
    }

    requestHandlers(req: IncomingMessage, res: ServerResponse){

        // application/json
        res.writeHead(200, {'Content-type': 'text/html'});
        res.write('Hello Node JS Server Response');
        res.end();
    }

    run(){
        createServer((req, res) => z.requestHandlers(req, res)).listen(8888);
    }

}


// TODO: make this singleton
export const z = new Zebra();
