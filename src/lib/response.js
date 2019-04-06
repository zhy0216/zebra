"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Response {
    constructor(content, headers, statusCode = 200) {
        this.content = content;
        this.headers = headers || {};
        this.statusCode = statusCode;
        this.headers["Content-Type"] = this.contentType;
    }
    get contentType() {
        return this.headers["Content-Type"] || "application/json; charset=utf-8";
    }
    static buildFromHandlerResult(result) {
        if (result instanceof Response) {
            return result;
        }
        return new Response(JSON.stringify(result), undefined);
    }
}
exports.Response = Response;
