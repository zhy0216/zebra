import {chain, toposort} from './utils';


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
        if(argsStr.length === 0){
            return ;
        }
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

    async _execute(extraClosure: Map<string, any>=new Map(), extraLazyClosure: Map<string, Func>=new Map()){
        const closure = new Map<string, any>(chain(this.closure, extraClosure));
        const lazyClosure = new Map<string, any>(chain(this.lazyClosure, extraLazyClosure));
        let args = {};
        args["length"] = this.parameters.length;
        for(let parameter of this.parameters){
            let argName = parameter.name;
            if(parameter.isRequired && !closure.has(argName) && !lazyClosure.has(argName)) {
                throw Error(`function ${this.name} does not have ${argName}`)
            }

            let value = closure.get(argName);

            if(lazyClosure.has(argName)){
                const lazyFunc = lazyClosure.get(argName);
                value = await Promise.resolve(lazyFunc._execute(extraClosure, extraLazyClosure))
            }

            // only search in closure
            args[parameter.index] = value;

        }
        return await Promise.resolve(this.func.apply(null, args));
    }

    async execute(extraClosure: Map<string, any>=new Map(), extraLazyClosure: Map<string, Func>=new Map()){
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/apply
        // use a custom object like { 'length': 2, '0': 'eat', '1': 'bananas' }
        const lazyClosure = new Map<string, Func>(chain(this.lazyClosure, extraLazyClosure));
        const reorderParameterMap = new Map<string, Parameter>();

        const constraintGraph = new Map<string, Set<string>>();
        for(const [name, func] of lazyClosure){
            constraintGraph[name] = new Set(func.parameters.filter(p=> p.isRequired));
        }

        for(const name of toposort(constraintGraph, true)){
            const parameter = this.parameters.find(p => p.name == name);
            if(parameter !== undefined){
                reorderParameterMap.set(name.toString(), parameter);
            }
        }

        for(const parameter of this.parameters){
            if(!reorderParameterMap.has(parameter.name)){
                reorderParameterMap.set(parameter.name, parameter);
            }
        }

        this.parameters = Array.from(reorderParameterMap.values());
        const r = await this._execute(extraClosure, extraLazyClosure);
        // some exit logic here

        return r;
    }

}


