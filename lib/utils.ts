import jwt from 'jsonwebtoken';

export function objectToMap(obj: Object): Map<string, any>{
    return new Map<string, any>(Object.entries(obj));
}

export function* chain (...iterators) {
  for (let iterator of iterators)
    for (let x of iterator)
      yield x;
}

export function union<T>(set1: Set<T>, set2: Set<T>){
    const unionSet = new Set(set1);
    for (const elem of set2) {
        unionSet.add(elem);
    }
    return unionSet;
}


export function difference<T>(set1: Set<T>, set2: Set<T>): Set<T>{
    const differenceSet = new Set(set1);
    for (const elem of set2) {
        differenceSet.delete(elem);
    }
    return differenceSet;
}

export function toposort<T, U>(graph: Map<T, Set<U>>, flatten=false): Array<Array<T>> | Array<T>{
    const r: Array<Array<T>> = [];
    const freeNodeSet = new Set();
    graph = new Map<T, Set<U>>(graph); // make sure the original graph does not change

    while(true){
        let visitList: Array<T> = [];
        for(const [node, nodeSet] of graph){
            if(difference<U>(nodeSet, freeNodeSet).size === 0){
                visitList.push(node)
            }
        }

        for(const node of visitList){
            graph.delete(node);
            freeNodeSet.add(node);
        }

        if(visitList.length === 0){
            break;
        }

        r.push(visitList);
    }

    if(graph.size !== 0){
        throw Error
    }

    if(flatten){
        r.reduce((acc, val) => acc.concat(val), []);
        return r;
    }
    return r;
}

export async function jwt_sign(data, secret){
    return await new Promise(function (resolve) {
        jwt.sign(data, secret, { algorithm: 'HS256' }, function(err, token) {
          resolve(token);
        });
    })
}

export async function jwt_decode(token , secret) {
    return await new Promise(function (resolve, reject) {
        jwt.verify(token, secret, function (err, decoded) {
            resolve(decoded);
        });
    })
}
