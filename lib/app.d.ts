import { IncomingMessage, ServerResponse, Server } from "http";
import { RouterManager } from "./router";
import { Response } from "./response";
import { Func } from "./func";
declare type EventFunc = (() => void | Promise<void>);
interface ZebraEvent {
    beforeRun: EventFunc[];
    beforeStop: EventFunc[];
}
export declare class Zebra {
    routerManager: RouterManager;
    server: Server;
    ascii: string;
    lazyEnv: Map<string, Func>;
    events: ZebraEvent;
    constructor();
    addBeforeRun(func: EventFunc): void;
    addBeforeStop(func: EventFunc): void;
    addPathPattern(pathPattern: string, methods: Set<string>, handler: Function): void;
    addGet(path: string, handler: Function): void;
    addPost(path: string, handler: Function): void;
    addDelete(path: string, handler: Function): void;
    addPatch(path: string, handler: Function): void;
    static(routPath: string, filepath: string): void;
    inject(arg1: Function | string, func?: Function): void;
    sendFile(filename: string): Promise<Response>;
    getRequestBody(req: IncomingMessage): Promise<{}>;
    requestHandlers(req: IncomingMessage, res: ServerResponse): Promise<void>;
    run(port?: number): Promise<void>;
    stop(): Promise<void>;
}
export declare const z: Zebra;
export {};
