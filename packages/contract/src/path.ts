/**
 * Vendored path types, kept structurally identical to the originals in
 * packages/core/src/app/types.ts (guarded by a parity type test in
 * test/parity.test.ts).
 */
type SegmentParam<S extends string> = S extends `:${infer Name}`
  ? Name
  : S extends `*${infer Name}`
    ? Name
    : never;

type PathParamNames<Path extends string> = Path extends `${infer Head}/${infer Tail}`
  ? SegmentParam<Head> | PathParamNames<Tail>
  : SegmentParam<Path>;

export type PathParams<Path extends string> = string extends Path
  ? Record<string, string>
  : [PathParamNames<Path>] extends [never]
    ? Record<never, string>
    : { [K in PathParamNames<Path>]: string };

export type JoinPath<Prefix extends string, Path extends string> = Path extends `/${string}`
  ? `${Prefix}${Path}`
  : `${Prefix}/${Path}`;
