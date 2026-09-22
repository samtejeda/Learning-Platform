import { NextResponse, type NextRequest } from "next/server";
import { assertUser } from "@/lib/auth/session";
import { recordProgress } from "@/lib/data/progress";
import { enforceRateLimit } from "@/lib/rate-limit";
import { handleRouteError, isSameOrigin, jsonError } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/validation/courses";
import { progressSegmentSchema } from "@/lib/validation/progress";

/**
 * POST /api/lectures/[lectureId]/progress
 * Body: { from, to, position? } — one short segment the player just played.
 *
 * The server merges it into the student's watched ranges and decides
 * completion (lib/progress/policy.ts): segments over 20 s are rejected
 * (400), and coverage can't grow faster than wall-clock time allows —
 * such pings are ignored with `accepted: false` (200) rather than counted.
 * Requires enrollment + a published lecture (else 404). Only students'
 * progress is recorded; a professor previewing gets 404 here.
 *
 * Response: { accepted, percent, completed, watchedSeconds, intervals }.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ lectureId: string }> }) {
  try {
    if (!isSameOrigin(request)) return jsonError(403, "forbidden");

    const user = await assertUser();

    const id = uuidSchema.safeParse((await ctx.params).lectureId);
    if (!id.success) return jsonError(404, "not_found");

    const limited = await enforceRateLimit("lecture_progress", user.id);
    if (limited) return jsonError(429, "rate_limited", limited);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "invalid_input");
    }
    const parsed = progressSegmentSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "invalid_input");

    const result = await recordProgress(
      id.data,
      user.id,
      { from: parsed.data.from, to: parsed.data.to },
      parsed.data.position,
    );

    if (!result.ok) {
      switch (result.reason) {
        case "not_found":
          return jsonError(404, "not_found");
        case "no_duration":
          return jsonError(409, "not_ready", "This lecture isn't ready for playback yet.");
        case "invalid_segment":
        case "too_long":
          return jsonError(400, "invalid_input", "Invalid playback segment.");
        case "too_fast":
          // Ignored, not an error: the client keeps playing, nothing is credited.
          return NextResponse.json({ accepted: false, reason: "too_fast" }, { headers: { "Cache-Control": "no-store" } });
      }
    }

    const { percent, completed, watchedSeconds, intervals } = result.progress;
    return NextResponse.json(
      { accepted: true, percent, completed, watchedSeconds, intervals, justCompleted: result.justCompleted },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
