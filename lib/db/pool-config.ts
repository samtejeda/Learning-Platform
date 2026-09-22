// Pure connection-pool sizing helpers. No DB or Next imports, so they are
// unit-tested directly and lib/db/index.ts stays a thin wiring file.

/** Connections held open PER app instance in production. */
export const DEFAULT_PROD_POOL_MAX = 5;
const MAX_ALLOWED = 20;

/**
 * Why 5 and not 10: on Vercel every concurrent function instance gets its own
 * pool. Instances × pool size is what reaches Supavisor, so a per-instance
 * pool of 10 exhausts the pooler's client-connection cap at modest traffic.
 * In transaction mode connections are multiplexed, so a small per-instance
 * pool costs little throughput. Override with DB_POOL_MAX (1–20) if measured
 * numbers say otherwise; anything unparseable falls back to the default.
 * Development stays at 1 (hot reload + single-connection debugging).
 */
export function resolvePoolMax(raw: string | undefined, isProd: boolean): number {
  // Whole-string digits only: parseInt("3.5x") would happily return 3.
  if (raw !== undefined && /^\d{1,2}$/.test(raw)) {
    const n = Number(raw);
    if (n >= 1 && n <= MAX_ALLOWED) return n;
  }
  return isProd ? DEFAULT_PROD_POOL_MAX : 1;
}

/** Supabase's transaction-mode pooler (Supavisor) listens on 6543. */
export function isTransactionPoolerUrl(url: string): boolean {
  try {
    return new URL(url).port === "6543";
  } catch {
    return false;
  }
}

/** Timeouts (seconds) so a dead or idle connection can't wedge an instance. */
export const POOL_TIMEOUTS = {
  /** Close connections idle this long; frees pooler slots between traffic bursts. */
  idle_timeout: 20,
  /** Fail fast instead of hanging a request when the DB is unreachable. */
  connect_timeout: 10,
  /** Recycle long-lived connections (30 min), which also survives DB restarts cleanly. */
  max_lifetime: 60 * 30,
} as const;
