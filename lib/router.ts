import XRegExp from 'xregexp';

interface VariableBind{
    [variable: string]: string;
}




export class UrlExtractor{
    pattern: string;
    metaPattern: XRegExp;
    // registerVariable: Set<string>;
    constructor(urlPattern: string) {
        const self = this;
        this.pattern = urlPattern;
        // this.registerVariable = new Set<string>();
        this.metaPattern = XRegExp(XRegExp.replace(urlPattern, XRegExp('{(?<var>\\w+)}'), function (match) {
            return `(?<${match.var}>\\w+)`;
        }, 'all'));

    }


    match(url): boolean {
        return this.metaPattern.test(url);
    }

    extract(url): VariableBind{
        const r = {};
        const data = XRegExp.exec(url, this.metaPattern);
        for(const variable_name of this.metaPattern.xregexp.captureNames){
            r[variable_name] = data[variable_name];
        }
        return r;
    }
}

export class Router{
    methods: Set<string>;
    urlExtractor: UrlExtractor;
    func: Function;
    constructor(methods, urlPattern, func){
        this.methods = methods;
        this.urlExtractor = new UrlExtractor(urlPattern);
        this.func = func;
    }
}

export class RouterManager{

}
