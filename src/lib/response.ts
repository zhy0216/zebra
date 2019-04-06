export class Response {
    content: string | Buffer;
    headers: Dict<string>;
    statusCode: number;
    constructor(content, headers, statusCode = 200) {
        this.content = content;
        this.headers = headers || {};
        this.statusCode = statusCode;
        this.headers["Content-Type"] = this.contentType;
    }

    get contentType() {
        return this.headers["Content-Type"] || "application/json; charset=utf-8";
    }

    static buildFromHandlerResult(result: object) {
        if (result instanceof Response) {
            return result;
        }
        return new Response(JSON.stringify(result), undefined);

    }


}
