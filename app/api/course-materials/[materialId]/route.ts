import { NextResponse, type NextRequest } from "next/server";
import { assertUser } from "@/lib/auth/session";
import { getMaterialForViewer } from "@/lib/data/course-materials";
import { createCourseFileUrl, StorageError } from "@/lib/storage";
import { enforceRateLimit } from "@/lib/rate-limit";
import { handleRouteError, jsonError } from "@/lib/api/respond";
import { uuidSchema } from "@/lib/validation/courses";

/**
 * GET /api/course-materials/[materialId]
 *
 * Returns a short-lived signed URL for a file-kind course material.
 * Students must be enrolled in the course and the material must be
 * published; the owning professor (or an admin) may preview any status.
 * Unauthorised, non-existent, and link-kind materials (no server object to
 * sign — the URL is already in the page data and rendered as a plain
 * outbound <a>, never proxied or fetched server-side) are all 404.
 *
 * Response: { url, expiresAt } — nothing else. Never cached.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ materialId: string }> }) {
  try {
    const user = await assertUser();

    const id = uuidSchema.safeParse((await ctx.params).materialId);
    if (!id.success) return jsonError(404, "not_found");

    const limited = await enforceRateLimit("course_file", user.id);
    if (limited) return jsonError(429, "rate_limited", limited);

    const material = await getMaterialForViewer(id.data, user);
    if (!material) return jsonError(404, "not_found");

    let signed;
    try {
      signed = await createCourseFileUrl(material.storagePath);
    } catch (err) {
      if (!(err instanceof StorageError)) throw err;
      return jsonError(503, "storage_unavailable", "That file is unavailable right now. Please try again.");
    }

    return NextResponse.json(
      { url: signed.url, expiresAt: signed.expiresAt.toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
