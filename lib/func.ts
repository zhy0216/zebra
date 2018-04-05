import {chain} from './utils';


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
    closure: Map<string,any>;
    lazyClosure: Map<string, Func>;
    parameters: Array<Parameter>;
    name: string | null;
    static STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;

    constructor(func, closure?: Map<string,any>, lazyClosure?:Map<string, Func>){
        this.func = func;
        this.name = null;
        this.closure = closure || new Map<string,any>();
        this.lazyClosure = lazyClosure || new Map<string, Func>();
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

    execute(extraClosure: Map<string, any>=new Map(), extraLazyClosure: Map<string, Func>=new Map()){
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/apply
        // use a custom object like { 'length': 2, '0': 'eat', '1': 'bananas' }
        const closure = new Map<string, any>(chain(this.closure, extraClosure));
        let args = {};
        args["length"] = this.parameters.length;
        for(let parameter of this.parameters){
            let argName = parameter.name;
            // only search in closure
            args[parameter.index] = closure.get(argName);
        }
        return this.func.apply(null, args);
    }

}


