import { Func } from "./func";
export declare class UrlExtractor {
    private pattern;
    private readonly metaPattern;
    constructor(urlPattern: string);
    match(url: any): boolean;
    extract(url: any): Map<string, string>;
}
export declare class Router {
    private methods;
    private urlExtractor;
    func: Function;
    constructor(methods: any, urlPattern: any, func: Function);
    match(url: any, method: any): boolean;
    extract(url: any): Map<string, string>;
}
export declare class RouterManager {
    routerList: Router[];
    constructor();
    add(router: Router): void;
    getFunction(url: any, method?: string): Func;
}
