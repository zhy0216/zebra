
interface VariableBind{
    [variable: string]: any;
}

interface VariableExtractor{
    [variable: string]: RegExp;
}



class UrlExtractor{
    pattern: RegExp;
    variableExtractor: VariableExtractor;
    constructor(){
        this.pattern = new RegExp("");
        this.variableExtractor = {};
    }

    match(url): boolean {
        throw new Error();
    }

    extract(url): VariableBind{
        throw new Error();
    }
}

class Router{
    methods: Set<string>;
    urlExtractor: UrlExtractor;
    func: Function;
    constructor(){
        this.methods = new Set();
        this.urlExtractor = new UrlExtractor();
        this.func = ()=> 1;
    }
}

