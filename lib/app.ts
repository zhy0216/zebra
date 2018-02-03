
export interface RegisteredHandler{
    [variable: string]: Function;
}

export class Zebra{
    registeredHandler: RegisteredHandler;
    constructor(){
        this.registeredHandler = {};
    }

    addPath(path: string, method: string, handler: Function){

    }

    addGet(path: string, handler: Function){
        this.addPath(path, "GET", handler);
    }

}



export const z = new Zebra();
