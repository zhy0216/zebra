
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
    static STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;

    constructor(func, closure=null, lazyClosure=null){
        this.func = func;
        this.closure = closure || {};
        this.lazyClosure = lazyClosure || {};
        this.parameters = [];
        this._parseFunc(func);
    }

    _parseFunc(f){
        const fnStr = f.toString().replace(Func.STRIP_COMMENTS, '');
        const argsStr = fnStr.slice(fnStr.indexOf('(')+1, fnStr.indexOf(')'));
        const argsList = argsStr.replace(/ /g, "").split(",");
        for(let index in argsList){
            let argName = argsList[index];
            let equationIndex = argName.indexOf("=");
            if(equationIndex === -1){
                this.parameters.push(new Parameter(argName, true, index));
            }else{
                this.parameters.push(new Parameter(argName.slice(0, equationIndex), false, index));
            }
        }

    }

}


