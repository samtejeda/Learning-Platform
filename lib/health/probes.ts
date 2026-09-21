import "server-only";

import { sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { createTtlCache, runCheck, summarize, type Checks } from "./checks";

const PROBE_TIMEOUT_MS = 3_000;
/** At most one round of probes per instance per this window, however many callers. */
const CACHE_TTL_MS = 10_000;

async function probeDatabase() {
  // Imported lazily: lib/db throws at import when DATABASE_URL is missing, and
  // that must surface as a failed check (503), not a crashed route.
  const { db } = await import("@/lib/db");
  await db.execute(sql`select 1`);
}

/**
 * Supabase Auth's own health endpoint. The URL is built from our env var,
 * never from request input, and redirects are refused, so there is no SSRF
 * surface. Twilio is only reachable through Supabase Auth and has no direct
 * probe (known blind spot, see docs/RUNBOOK.md).
 */
async function probeAuth() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !anonKey) throw new Error("Supabase env vars are not set");

  const res = await fetch(`${base}/auth/v1/health`, {
    headers: { apikey: anonKey },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    redirect: "error",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`auth health returned ${res.status}`);
}

const cache = createTtlCache<Checks>(CACHE_TTL_MS);

async function runProbes(): Promise<Checks> {
  const [database, auth] = await Promise.all([
    runCheck(probeDatabase, PROBE_TIMEOUT_MS, (err) =>
      logger.warn("health.check_failed", { check: "database", err }),
    ),
    runCheck(probeAuth, PROBE_TIMEOUT_MS, (err) =>
      logger.warn("health.check_failed", { check: "auth", err }),
    ),
  ]);
  return { database, auth };
}

/** Cached, timeout-bounded dependency check for GET /api/health. */
export async function getHealthReport() {
  return summarize(await cache.get(runProbes));
}
