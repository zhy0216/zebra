
export const NONE = Symbol();

export class Parameter{
    name: string;
    isRequired: boolean;
    index: number;

    constructor(name, isRequired, index){
        this.name = name;
        this.isRequired = isRequired;
        this.index = index;
    }

}

export class Func{
    func: Function;
    closure: Dict<any>;
    lazyClosure: Dict<Func>;
    parameters: Array<Parameter>;

    constructor(func, closure=null,){
        this.func = func;
        this.closure = closure || {};
        this.lazyClosure = {};
        this.parameters = [];
    }

    _parseFunc(func){

    }

}


