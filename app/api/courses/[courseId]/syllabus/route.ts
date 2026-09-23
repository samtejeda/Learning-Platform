import { NextResponse, type NextRequest } from "next/server";
import { assertUser } from "@/lib/auth/session";
import { getSyllabusForViewer } from "@/lib/data/courses";
import { createCourseFileUrl, StorageError } from "@/lib/storage";
import { enforceRateLimit } from "@/lib/rate-limit";
import { handleRouteError, jsonError } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/validation/courses";

/**
 * GET /api/courses/[courseId]/syllabus
 *
 * Returns a short-lived signed URL for the course's syllabus PDF. Students
 * must be enrolled; the owning professor (or an admin) may fetch it too.
 * Unauthorised, unenrolled, and no-syllabus-yet are all 404 so ids can't be
 * probed and "no syllabus" can't be distinguished from "not your course".
 *
 * Response: { url, expiresAt } — nothing else. Never cached.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ courseId: string }> }) {
  try {
    const user = await assertUser();

    const id = uuidSchema.safeParse((await ctx.params).courseId);
    if (!id.success) return jsonError(404, "not_found");

    const limited = await enforceRateLimit("course_file", user.id);
    if (limited) return jsonError(429, "rate_limited", limited);

    const syllabus = await getSyllabusForViewer(id.data, user);
    if (!syllabus) return jsonError(404, "not_found");

    let signed;
    try {
      signed = await createCourseFileUrl(syllabus.storagePath);
    } catch (err) {
      if (!(err instanceof StorageError)) throw err;
      return jsonError(503, "storage_unavailable", "The syllabus is unavailable right now. Please try again.");
    }

    return NextResponse.json(
      { url: signed.url, expiresAt: signed.expiresAt.toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
