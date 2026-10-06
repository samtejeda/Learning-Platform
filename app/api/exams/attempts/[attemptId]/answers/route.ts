import { NextResponse, type NextRequest } from "next/server";
import { assertUser } from "@/lib/auth/session";
import { saveAttemptAnswers } from "@/lib/data/exam-attempts";
import { enforceRateLimit } from "@/lib/rate-limit";
import { handleRouteError, isSameOrigin, jsonError } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/validation/courses";
import { answersSchema } from "@/lib/validation/exams";

/**
 * PUT /api/exams/attempts/[attemptId]/answers
 * Body: { answers: [{ questionId, selectedOption? | answerText? }] }
 *
 * Autosave for an in-progress attempt: replaces the attempt's saved answers
 * with the posted set (partial is fine; blank text counts as unanswered).
 * The attempt must be the caller's own, the caller still enrolled, and the
 * exam published; the deadline is enforced here, on the server. Past the
 * deadline the attempt is closed with what was already saved (409
 * `expired`). Never returns answer keys: the response is just a timestamp.
 *
 * Response: { saved: true, deadline }.
 */
export async function PUT(request: NextRequest, ctx: { params: Promise<{ attemptId: string }> }) {
  try {
    if (!isSameOrigin(request)) return jsonError(403, "forbidden");

    const user = await assertUser();

    const id = uuidSchema.safeParse((await ctx.params).attemptId);
    if (!id.success) return jsonError(404, "not_found");

    const limited = await enforceRateLimit("exam_autosave", user.id);
    if (limited) return jsonError(429, "rate_limited", limited);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "invalid_input");
    }
    const parsed = answersSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "invalid_input");

    const result = await saveAttemptAnswers(id.data, user.id, parsed.data.answers);
    if (!result.ok) {
      switch (result.reason) {
        case "not_found":
          return jsonError(404, "not_found");
        case "already_submitted":
          return jsonError(409, "already_submitted", "This attempt was already submitted.");
        case "expired":
          return jsonError(409, "expired", "Time ran out. Your saved answers were submitted.");
        default:
          return jsonError(400, "invalid_input");
      }
    }
    return NextResponse.json(
      { saved: true, deadline: result.deadline.toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
