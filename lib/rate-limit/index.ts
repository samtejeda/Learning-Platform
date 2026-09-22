import "server-only";

import { headers } from "next/headers";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rateLimitBuckets } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import {
  bucketKey,
  clientIpFromHeaders,
  evaluate,
  RATE_LIMITS,
  retryMessage,
  type Scope,
  type Window,
} from "./policy";

export { RATE_LIMITS, retryMessage, type Scope } from "./policy";

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSeconds: number };

/**
 * Fixed-window counter backed by Postgres. One atomic upsert per check:
 * if the stored window has expired the count resets to 1 and the window
 * restarts, otherwise the count increments. No read-modify-write race.
 *
 * Fails CLOSED: if the database is unreachable the attempt is rejected.
 * The same DB backs getCurrentUser(), so nothing would work anyway, and
 * "DB down ⇒ unlimited login attempts" is the wrong failure mode.
 */
export async function checkRateLimit(opts: {
  scope: Scope;
  kind: "ip" | "id";
  subject: string;
  window: Window;
}): Promise<RateLimitResult> {
  const key = bucketKey(opts.scope, opts.kind, opts.subject);
  const interval = sql`make_interval(secs => ${opts.window.windowSeconds}::double precision)`;

  try {
    const [row] = await db
      .insert(rateLimitBuckets)
      .values({ key, count: 1, windowStart: sql`now()` })
      .onConflictDoUpdate({
        target: rateLimitBuckets.key,
        set: {
          count: sql`CASE WHEN ${rateLimitBuckets.windowStart} < now() - ${interval} THEN 1 ELSE ${rateLimitBuckets.count} + 1 END`,
          windowStart: sql`CASE WHEN ${rateLimitBuckets.windowStart} < now() - ${interval} THEN now() ELSE ${rateLimitBuckets.windowStart} END`,
        },
      })
      .returning({ count: rateLimitBuckets.count, windowStart: rateLimitBuckets.windowStart });

    // Opportunistic sweep of stale buckets (~1% of calls). Awaited on
    // purpose: a fire-and-forget drizzle query never executed and pinned the
    // connection (found 2026-09-18 via lib/rate-limit/sweep.integration.test.ts),
    // which froze the single-connection dev pool. The DELETE touches a
    // handful of rows and costs a few ms.
    if (Math.random() < 0.01) {
      try {
        await db
          .delete(rateLimitBuckets)
          .where(sql`${rateLimitBuckets.windowStart} < now() - interval '1 day'`);
      } catch (err) {
        logger.error("rate_limit.sweep_failed", { err });
      }
    }

    return evaluate(opts.window, row.count, row.windowStart);
  } catch (err) {
    logger.error("rate_limit.check_failed_closed", { scope: opts.scope, err });
    return { ok: false, retryAfterSeconds: 60 };
  }
}

export async function getClientIp(): Promise<string> {
  const h = await headers();
  return clientIpFromHeaders((name) => h.get(name));
}

/**
 * Apply a scope's per-IP and per-identifier limits in one call. Returns
 * null when allowed, or a user-facing message. For authenticated scopes the
 * identifier is the acting user's id.
 */
export async function enforceRateLimit(
  scope: Scope,
  identifier: string | null,
): Promise<string | null> {
  const policy = RATE_LIMITS[scope];
  const ip = await getClientIp();

  const byIp = await checkRateLimit({ scope, kind: "ip", subject: ip, window: policy.perIp });
  if (!byIp.ok) {
    logger.warn("auth.rate_limited", { scope, dimension: "ip" });
    return retryMessage(byIp.retryAfterSeconds);
  }

  if (identifier) {
    const byId = await checkRateLimit({
      scope,
      kind: "id",
      subject: identifier.toLowerCase(),
      window: policy.perIdentifier,
    });
    if (!byId.ok) {
      logger.warn("auth.rate_limited", { scope, dimension: "identifier" });
      return retryMessage(byId.retryAfterSeconds);
    }
  }
  return null;
}

/** Original name, kept for the auth actions. Same function. */
export const enforceAuthRateLimit = enforceRateLimit;
