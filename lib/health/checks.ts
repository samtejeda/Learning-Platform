// Pure health-check plumbing: timeouts, result caching, and the public report
// shape. No DB, no Next imports, so it is unit-tested directly. The probes
// that do real I/O live in probes.ts.

export type CheckResult = "ok" | "fail";

export type Checks = { database: CheckResult; auth: CheckResult };

/** What the public endpoint returns. Deliberately tiny: no versions, timings, hosts or error text. */
export type HealthReport =
  | { status: "ok" }
  | { status: "degraded"; checks: Checks };

export function summarize(checks: Checks): { httpStatus: 200 | 503; body: HealthReport } {
  if (checks.database === "ok" && checks.auth === "ok") {
    return { httpStatus: 200, body: { status: "ok" } };
  }
  return { httpStatus: 503, body: { status: "degraded", checks } };
}

/**
 * Run a probe with a hard deadline. A rejection or a timeout is "fail"; this
 * never throws, so one broken dependency can't take the endpoint down with it.
 * `onFailure` receives the reason for logging (never for the response body).
 */
export async function runCheck(
  probe: () => Promise<unknown>,
  timeoutMs: number,
  onFailure?: (reason: unknown) => void,
): Promise<CheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`health probe timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return "ok";
  } catch (reason) {
    onFailure?.(reason);
    return "fail";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Time-based cache that also coalesces concurrent callers onto one in-flight
 * load. Bounds how hard an unauthenticated endpoint can hit the database: at
 * most one load per `ttlMs` per instance, however many requests arrive.
 */
export function createTtlCache<T>(ttlMs: number, now: () => number = Date.now) {
  let value: { data: T; expiresAt: number } | undefined;
  let inflight: Promise<T> | undefined;

  return {
    async get(load: () => Promise<T>): Promise<T> {
      if (value && now() < value.expiresAt) return value.data;
      if (inflight) return inflight;
      inflight = load()
        .then((data) => {
          value = { data, expiresAt: now() + ttlMs };
          return data;
        })
        .finally(() => {
          inflight = undefined;
        });
      return inflight;
    },
  };
}
