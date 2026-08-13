import type { Middleware } from "./types.ts";

export async function compose(
  req: any,
  mws: Middleware[],
  final: () => Promise<Response>,
): Promise<Response> {
  // Zero-middleware fast path: no chain, no closures, no next() guard state.
  if (mws.length === 0) return final();
  let lastCalled = -1;
  const dispatch = async (idx: number): Promise<Response> => {
    if (idx <= lastCalled) throw new Error("next() called multiple times");
    lastCalled = idx;
    if (idx === mws.length) return final();
    const mw = mws[idx]!;
    return mw(req, () => dispatch(idx + 1));
  };
  return dispatch(0);
}
