export declare function objectToMap(obj: object): Map<string, any>;
export declare function chain(...iterators: any[]): IterableIterator<any>;
export declare function union<T>(set1: Set<T>, set2: Set<T>): Set<T>;
export declare function difference<T>(set1: Set<T>, set2: Set<T>): Set<T>;
export declare function toposort<T, U>(graph: Map<T, Set<U>>, flatten?: boolean): T[][] | T[];
export declare function jwtSign(data: any, secret: any): Promise<{}>;
export declare function jwtDecode(token: any, secret: any): Promise<{}>;
