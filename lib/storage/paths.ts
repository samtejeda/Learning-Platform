// Pure helpers for lecture video objects: bucket name, MIME allowlist, size
// cap, and the object path convention. No Supabase imports so this can be
// unit-tested and shared with validation schemas.

export const LECTURES_BUCKET = "lectures";

/** Container types the private bucket accepts (mirrors drizzle/0006). */
export const LECTURE_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export type LectureMimeType = (typeof LECTURE_MIME_TYPES)[number];

/** Hard ceiling enforced server-side before a signed upload URL is issued. */
export const LECTURE_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB (bucket cap)

const EXT_BY_MIME: Record<LectureMimeType, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export function isLectureMimeType(value: unknown): value is LectureMimeType {
  return typeof value === "string" && (LECTURE_MIME_TYPES as readonly string[]).includes(value);
}

export function extForMime(mime: LectureMimeType): string {
  return EXT_BY_MIME[mime];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Object path for a lecture's video. Both ids are server-generated UUIDs,
 * so the path can never contain user-controlled characters; the check is a
 * belt-and-braces guard against a caller passing something else.
 */
export function lectureObjectPath(courseId: string, lectureId: string, mime: LectureMimeType): string {
  if (!UUID_RE.test(courseId) || !UUID_RE.test(lectureId)) {
    throw new Error("lectureObjectPath: ids must be UUIDs");
  }
  return `courses/${courseId}/lectures/${lectureId}/video.${extForMime(mime)}`;
}
