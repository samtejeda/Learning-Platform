import { NextResponse, type NextRequest } from "next/server";
import { assertUser } from "@/lib/auth/session";
import { getLectureForViewer } from "@/lib/data/progress";
import { createLectureStreamUrl, StorageError } from "@/lib/storage";
import { enforceRateLimit } from "@/lib/rate-limit";
import { handleRouteError, jsonError } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/validation/courses";

/**
 * GET /api/lectures/[lectureId]/stream
 *
 * Returns a short-lived signed URL for the lecture video. Students must be
 * enrolled in the course and the lecture must be published; the owning
 * professor (or an admin) may preview any status. Unauthorised and
 * non-existent lectures are both 404 so ids can't be probed.
 *
 * Response: { url, expiresAt } — nothing else. Never cached.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ lectureId: string }> }) {
  try {
    const user = await assertUser();

    const id = uuidSchema.safeParse((await ctx.params).lectureId);
    if (!id.success) return jsonError(404, "not_found");

    const limited = await enforceRateLimit("lecture_progress", user.id);
    if (limited) return jsonError(429, "rate_limited", limited);

    const lecture = await getLectureForViewer(id.data, user);
    if (!lecture) return jsonError(404, "not_found");

    let signed;
    try {
      signed = await createLectureStreamUrl(lecture.videoStoragePath);
    } catch (err) {
      if (!(err instanceof StorageError)) throw err;
      return jsonError(503, "storage_unavailable", "Video is unavailable right now. Please try again.");
    }

    return NextResponse.json(
      { url: signed.url, expiresAt: signed.expiresAt.toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
