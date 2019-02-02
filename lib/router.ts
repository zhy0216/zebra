import { Func } from "./func";

export class UrlExtractor {
    private pattern: string;
    private readonly metaPattern: RegExp;
    // registerVariable: Set<string>;
    constructor(urlPattern: string) {
        this.pattern = urlPattern;
        this.metaPattern = new RegExp("^" +
            urlPattern.replace(new RegExp("{(?<var>\\w+)}", "g"), (...params) => {
                const group = params.pop();
                return `(?<${group.var}>\\w+)`;
            })  +
            "$");
    }

    match(url): boolean {
        return this.metaPattern.test(url);
    }

    extract(url): Map<string, string> {
        const r = new Map<string, string>();
        const data = this.metaPattern.exec(url);
        if (data === null || data.groups === null) {
            return r;
        }

        for (const variableName of Object.keys(data.groups)) {
            r.set(variableName, data.groups[variableName]);
        }
        return r;
    }
}

export class Router {
    private methods: Set<string>;
    private urlExtractor: UrlExtractor;
    func: Function;
    constructor(methods, urlPattern, func: Function) {
        this.methods = methods;
        this.urlExtractor = new UrlExtractor(urlPattern);
        this.func = func;
    }

    public match(url, method): boolean {
        return this.urlExtractor.match(url) && this.methods.has(method);
    }

    public extract(url){
        return this.urlExtractor.extract(url);
    }
}

export class RouterManager {
    routerList: Router[];
    constructor() {
        this.routerList = [];
    }

    add(router: Router) {
        this.routerList.push(router);
    }

    getFunction(url, method= "GET"): Func {
        for (const router of this.routerList) {
            if (router.match(url, method)) {
                return new Func(router.func, router.extract(url))
            }
        }
        throw new Error(); // a better exception
    }
}
