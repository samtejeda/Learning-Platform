import { NextResponse, type NextRequest } from "next/server";
import { assertUser } from "@/lib/auth/session";
import { submitComprehensionAnswer } from "@/lib/data/lecture-comprehension";
import { enforceRateLimit } from "@/lib/rate-limit";
import { handleRouteError, isSameOrigin, jsonError } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/validation/courses";
import { comprehensionAnswerSchema } from "@/lib/validation/lecture-comprehension";

/**
 * POST /api/lectures/[lectureId]/comprehension
 * Body: { selectedOption } — the POSITION of the option the student chose
 * (language-independent). Nothing else is accepted.
 *
 * The server decides which question this attempt is (attempt 1 = question 1;
 * attempt 2 = question 2 if the professor wrote one, else question 1 again),
 * compares the answer to the key inside SQL, and records only the attempt
 * number, the question slot and right/wrong (never the chosen option). Two
 * attempts total. The key is never returned.
 *
 * Requires an enrolled student, a published lecture and the question switched
 * on, all in one query (else 404, indistinguishable between them), and the
 * lecture completed by server-validated watch progress (else 409).
 *
 * Response: { correct, status, attemptsRemaining, nextQuestion } where status
 * is "passed" | "retry" | "blocked" and nextQuestion (both languages, no key)
 * is set only when the student may retry.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ lectureId: string }> }) {
  try {
    if (!isSameOrigin(request)) return jsonError(403, "forbidden");

    const user = await assertUser();

    const id = uuidSchema.safeParse((await ctx.params).lectureId);
    if (!id.success) return jsonError(404, "not_found");

    const limited = await enforceRateLimit("lecture_comprehension", user.id);
    if (limited) return jsonError(429, "rate_limited", limited);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "invalid_input");
    }
    const parsed = comprehensionAnswerSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "invalid_input");

    const result = await submitComprehensionAnswer(id.data, user.id, parsed.data.selectedOption);

    if (!result.ok) {
      switch (result.reason) {
        case "not_found":
          return jsonError(404, "not_found");
        case "out_of_range":
          return jsonError(400, "invalid_input");
        case "not_completed":
          return jsonError(409, "not_completed", "Finish watching the lecture before answering.");
        case "already_passed":
          return jsonError(409, "already_passed", "You've already answered this correctly.");
        case "no_attempts_left":
          return jsonError(409, "no_attempts_left", "No attempts left.");
        case "conflict":
          return jsonError(409, "conflict", "That answer was already submitted.");
      }
    }

    return NextResponse.json(
      {
        correct: result.correct,
        status: result.status,
        attemptsRemaining: result.attemptsRemaining,
        nextQuestion: result.nextQuestion,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
