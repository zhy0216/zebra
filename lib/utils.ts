


const STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
const ARGUMENT_NAMES = /(?:^|,)\s*([^\s,=]+)/g;

// https://stackoverflow.com/a/29123804
export function getFunctionParameters (f: Function): string[]{
    const fnStr = f.toString().replace(STRIP_COMMENTS, '');
    const argsList = fnStr.slice(fnStr.indexOf('(')+1, fnStr.indexOf(')'));
    const result = argsList.match( ARGUMENT_NAMES );

    if(result === null) {
        return [];
    }
    const stripped: string[] = [];
    for (let i = 0; i < result.length; i++  ) {
        stripped.push(result[i].replace(/[\s,]/g, '') );
    }
    return stripped;
}


