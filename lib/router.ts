
interface VariableBind{
    [variable: string]: any;
}

class UrlExtractor{
    pattern: RegExp;
    constructor(){
        this.pattern = new RegExp("");
    }

    match(url): boolean {
        throw new Error();
    }

    extract(url): VariableBind{
        throw new Error();
    }
}