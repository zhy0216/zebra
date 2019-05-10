import { Response } from "./response";
export declare class Parameter {
    name: string;
    isRequired: boolean;
    index: number;
    constructor(name: any, isRequired: any, index: any);
}
export declare class Func {
    func: Function;
    closure: Map<string, any>;
    lazyClosure: Map<string, Func>;
    parameters: Parameter[];
    name?: string;
    static STRIP_COMMENTS: RegExp;
    constructor(func: any, closure?: Map<string, any>, lazyClosure?: Map<string, Func>);
    _parseFunc(f: any): void;
    _execute(extraClosure?: Map<string, any>, extraLazyClosure?: Map<string, Func>): Promise<any>;
    execute(extraClosure?: Map<string, any>, extraLazyClosure?: Map<string, Func>): Promise<Response>;
}
