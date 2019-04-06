/// <reference types="core-js" />
export declare class Response {
    content: string | Buffer;
    headers: Dict<string>;
    statusCode: number;
    constructor(content: any, headers: any, statusCode?: number);
    readonly contentType: string;
    static buildFromHandlerResult(result: object): Response;
}
