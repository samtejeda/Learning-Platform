import { NextResponse } from "next/server";
import { getHealthReport } from "@/lib/health/probes";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * For uptime monitors. Verifies the app can reach its two hard dependencies
 * (Postgres and Supabase Auth), not just that the server answers.
 *
 * Public by design (monitors have no session). Exposure is limited to
 * `{status:"ok"}` or `{status:"degraded", checks:{database, auth}}` with
 * ok/fail values: no versions, timings, hostnames or error text. Probe results
 * are cached ~10s per instance, so load on the dependencies is bounded no
 * matter who calls it. Never cached downstream.
 */
export async function GET() {
  const { httpStatus, body } = await getHealthReport();
  return NextResponse.json(body, {
    status: httpStatus,
    headers: { "Cache-Control": "no-store" },
  });
}
