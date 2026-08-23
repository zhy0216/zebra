import type { Middleware } from "@zebra-web/core";

export type Probe = () => boolean | Promise<boolean>;

export interface HealthOptions {
  /** Liveness endpoint path. Default `"/healthz"`. */
  path?: string;
  /** Readiness endpoint path. Default `"/readyz"`. */
  readinessPath?: string;
  /**
   * Liveness probe; a throwing probe is treated as unavailable. Default:
   * always healthy.
   */
  liveness?: Probe;
  /**
   * Readiness probe; a throwing probe is treated as unavailable. Default:
   * always healthy.
   */
  readiness?: Probe;
}

const DEFAULT_PATH = "/healthz";
const DEFAULT_READINESS_PATH = "/readyz";

async function probeHealthy(probe: Probe | undefined): Promise<boolean> {
  if (probe === undefined) return true;
  try {
    return (await probe()) === true;
  } catch (error) {
    // Health endpoints must always answer so load balancers get a decision;
    // a throwing probe is a failing probe, and the error is surfaced in logs.
    console.error("[zebra/health] probe threw:", error);
    return false;
  }
}

function healthResponse(ok: boolean): Response {
  return Response.json({ status: ok ? "ok" : "unavailable" }, { status: ok ? 200 : 503 });
}

/**
 * Health middleware: short-circuits `GET /healthz` (liveness) and
 * `GET /readyz` (readiness) with `{"status":"ok"}` / 200 or
 * `{"status":"unavailable"}` / 503 based on the probe callbacks (default:
 * always healthy). All other paths pass through untouched. Register it inside
 * the other observability middleware so probes are still logged and counted.
 */
export function health(options: HealthOptions = {}): Middleware {
  const path = options.path ?? DEFAULT_PATH;
  const readinessPath = options.readinessPath ?? DEFAULT_READINESS_PATH;
  const liveness = options.liveness;
  const readiness = options.readiness;

  return async (req, next) => {
    if (req.url.pathname === path) return healthResponse(await probeHealthy(liveness));
    if (req.url.pathname === readinessPath) {
      return healthResponse(await probeHealthy(readiness));
    }
    return next();
  };
}
