import {RouterManager, Router} from './router'

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

}


// TODO: make this singleton
export const z = new Zebra();
