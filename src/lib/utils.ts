import * as crypto from "crypto";

export function objectToMap(obj: object): Map<string, any> {
    return new Map<string, any>(Object.entries(obj));
}

export function* chain (...iterators) {
  for (const iterator of iterators) {
    for (const x of iterator) {
      yield x;
    }
  }
}

export function union<T>(set1: Set<T>, set2: Set<T>) {
    const unionSet = new Set(set1);
    for (const elem of set2) {
        unionSet.add(elem);
    }
    return unionSet;
}

export function difference<T>(set1: Set<T>, set2: Set<T>): Set<T> {
    const differenceSet = new Set(set1);
    for (const elem of set2) {
        differenceSet.delete(elem);
    }
    return differenceSet;
}

export function toposort<T, U>(graph: Map<T, Set<U>>, flatten= false): T[][] | T[] {
    const r: T[][] = [];
    const freeNodeSet = new Set();
    graph = new Map<T, Set<U>>(graph); // make sure the original graph does not change

    while (true) {
        const visitList: T[] = [];
        for (const [node, nodeSet] of graph) {
            if (difference<U>(nodeSet, freeNodeSet).size === 0) {
                visitList.push(node);
            }
        }

        for (const node of visitList) {
            graph.delete(node);
            freeNodeSet.add(node);
        }

        if (visitList.length === 0) {
            break;
        }

        r.push(visitList);
    }

    if (graph.size !== 0) {
        throw Error;
    }

    if (flatten) {
        r.reduce((acc, val) => acc.concat(val), []);
        return r;
    }
    return r;
}

const toBase64 = (str: string, encoding?: string) =>
  Buffer.from(str, encoding || "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");


export const fromBase64 = (bae64Str: string) => Buffer.from(bae64Str, "base64").toString("utf8");

const cleanSign = (sign: string) =>
  sign
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

export async function jwtSign(data, secret) {
    return new Promise((resolve) => {
        const header = toBase64(JSON.stringify({alg: "HS256", typ: "JWT"}), "binary");
        const payload = toBase64(JSON.stringify(data));
        const hmac = crypto.createHmac("sha256", secret);
        const data2 = header + "." + payload;
        hmac.update(data2);
        const sign = cleanSign(hmac.digest("base64"));
        resolve(data2 + "." + sign);
    });
}

export async function jwtDecode(token , secret) {
    return new Promise((resolve, reject) => {
        const [header, payload, sign] = token.split(".");
        const hmac = crypto.createHmac("sha256", secret);
        const data2 = header + "." + payload;
        hmac.update(data2);
        const sign2 = cleanSign(hmac.digest("base64"));

        if (sign === sign2) {
            resolve(JSON.parse(fromBase64(payload)));
        } else {
            reject("invalid token");
        }
    });
}
