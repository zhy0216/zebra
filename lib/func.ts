
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
    name: String | null;
    static STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;

    constructor(func, closure:Dict<any>|null=null, lazyClosure:Dict<Func>|null=null){
        this.func = func;
        this.name = null;
        this.closure = closure || {};
        this.lazyClosure = lazyClosure || {};
        this.parameters = [];
        this._parseFunc(func);
    }

    _parseFunc(f){
        //parse name
        if(f.name != "anonymous" || f.name != ""){
            this.name = f.name.split(" ").pop()
        }

        // parse parameter
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

    execute(extraClosure: Object|null=null, extraLazyClosure: Map<string, Func>|null=null){
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/apply
        // use a custom object like { 'length': 2, '0': 'eat', '1': 'bananas' }
        const closure = Object.assign({}, this.closure, extraClosure);
        let args = {};
        args["length"] = this.parameters.length;
        for(let parameter of this.parameters){
            let argName = parameter.name;
            // only search in closure
            args[parameter.index] = closure[argName];
        }
        return this.func.apply(null, args);
    }

}


