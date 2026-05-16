export interface Disposable {
  dispose(): void | Promise<void>;
}

export function isDisposable(x: unknown): x is Disposable {
  return typeof x === "object" && x !== null && typeof (x as any).dispose === "function";
}
