


function union<T>(set1: Set<T>, set2: Set<T>){
    const unionSet = new Set(set1);
    for (const elem of set2) {
        unionSet.add(elem);
    }
    return unionSet;
}


function difference<T>(set1: Set<T>, set2: Set<T>): Set<T>{
    const difference = new Set(set1);
    for (const elem of set2) {
        difference.delete(elem);
    }
    return difference;
}

function toposort<T>(graph: Map<T, Set<T>>, flattern=false): Array<Array<T>> | Array<T>{
    const r: Array<Array<T>> = [];
    const freeNodeSet = new Set();
    graph = new Map<T, Set<T>>(graph); // make sure the original graph does not change

    while(true){
        let visitList: Array<T> = [];
        for(const [node, nodeSet] of graph){
            if(difference<T>(nodeSet, freeNodeSet).size === 0){
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

    if(flattern){
        r.reduce((acc, val) => acc.concat(val), []);
        return r;
    }
    return r;
}