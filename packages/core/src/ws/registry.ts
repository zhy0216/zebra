import type { DepsSpec } from "../app/types.ts";
import { type MatchResult, Router } from "../router/radix.ts";
import type { WsHandler } from "./types.ts";

const WS_METHOD = "WS";

/** WS 路由表：复用 radix router 的路径参数匹配，方法键固定为 "WS"。 */
export class WsRegistry {
  // D/Up 是类型层面的声明，路由表统一按 WsHandler<any, any> 存取（运行时不关心）。
  private readonly router = new Router<WsHandler<any, any>>();

  add<D extends DepsSpec = never, Up extends Record<string, unknown> = Record<string, unknown>>(
    path: string,
    handler: WsHandler<D, Up>,
  ): void {
    if (!path.startsWith("/")) {
      throw new Error(`WS route path must start with "/", got "${path}"`);
    }
    this.router.add(WS_METHOD, path, handler);
  }

  find(pathname: string): MatchResult<WsHandler<any>> | null {
    return this.router.find(WS_METHOD, pathname);
  }
}
