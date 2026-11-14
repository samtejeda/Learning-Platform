import { NextResponse, type NextRequest } from "next/server";
import { assertUser } from "@/lib/auth/session";
import { getLectureForViewer } from "@/lib/data/progress";
import { createLectureStreamUrl, StorageError } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { toCdnUrl } from "@/lib/video-cdn/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { handleRouteError, jsonError } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/validation/courses";

/**
 * GET /api/lectures/[lectureId]/stream
 *
 * Tells the player where the lecture video comes from. Students must be
 * enrolled in the course and the lecture must be published; the owning
 * professor (or an admin) may preview any status. Unauthorised and
 * non-existent lectures are both 404 so ids can't be probed.
 *
 * Response, by the lecture's source (nothing else, never cached):
 *   upload  → { source: "upload", url, expiresAt }   short-lived signed URL
 *   youtube → { source: "youtube", videoId }          11-character id; no Storage or CDN call
 * 403 { error: { code: "locked" } } when an earlier comprehension question has
 * not been cleared by this student (and they haven't started this lecture).
 * A YouTube id is not secret (an unlisted video plays for anyone who has it),
 * so it is unsuitable for paid-only or enrolled-only content (API.md).
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
    const headers = { "Cache-Control": "no-store" };

    // Locked for this student (an earlier lecture's comprehension question is
    // not cleared). Same answer for uploads and YouTube, and checked before the
    // source is looked at, so no signed URL or video id is ever produced.
    if (lecture.locked) {
      return NextResponse.json(
        { error: { code: "locked", message: "Finish the previous lecture's question to unlock this lecture." } },
        { status: 403, headers },
      );
    }

    if (lecture.video.source === "youtube") {
      return NextResponse.json({ source: "youtube", videoId: lecture.video.videoId }, { headers });
    }

    const { storagePath } = lecture.video;
    let signed;
    try {
      signed = await createLectureStreamUrl(storagePath);
    } catch (err) {
      if (!(err instanceof StorageError)) throw err;
      return jsonError(503, "storage_unavailable", "Video is unavailable right now. Please try again.");
    }

    // Egress tripwire: count of issued URLs x average file size ~ video egress
    // (docs/RUNBOOK.md, section 7). Lecture id only; no user identifiers.
    logger.info("lecture.stream_url_issued", { lectureId: lecture.id });

    return NextResponse.json(
      { source: "upload", url: await toCdnUrl(storagePath, signed), expiresAt: signed.expiresAt.toISOString() },
      { headers },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
