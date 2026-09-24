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

// ─── Course files (syllabus + course materials) ────────────────────────────
// Separate private bucket from `lectures` (which stays video-only/
// progress-tracked). Same deny-all model: no storage policies, server-signed
// URLs only.

export const COURSE_FILES_BUCKET = "course-files";

/** Container types the private bucket accepts (mirrors drizzle/0007). */
export const COURSE_FILE_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;
export type CourseFileMimeType = (typeof COURSE_FILE_MIME_TYPES)[number];

/** Syllabus is PDF-only, per spec — a strict subset of the bucket allowlist. */
export const SYLLABUS_MIME_TYPES = ["application/pdf"] as const;
export type SyllabusMimeType = (typeof SYLLABUS_MIME_TYPES)[number];

/** Hard ceiling enforced server-side before a signed upload URL is issued. */
export const COURSE_FILE_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB (bucket cap)

const EXT_BY_COURSE_FILE_MIME: Record<CourseFileMimeType, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

export function isCourseFileMimeType(value: unknown): value is CourseFileMimeType {
  return typeof value === "string" && (COURSE_FILE_MIME_TYPES as readonly string[]).includes(value);
}

export function isSyllabusMimeType(value: unknown): value is SyllabusMimeType {
  return typeof value === "string" && (SYLLABUS_MIME_TYPES as readonly string[]).includes(value);
}

export function extForCourseFileMime(mime: CourseFileMimeType): string {
  return EXT_BY_COURSE_FILE_MIME[mime];
}

/**
 * Deterministic, fixed path for a course's syllabus — re-uploading replaces
 * it in place (upsert: true), so there is exactly one object per course.
 */
export function syllabusObjectPath(courseId: string): string {
  if (!UUID_RE.test(courseId)) {
    throw new Error("syllabusObjectPath: courseId must be a UUID");
  }
  return `courses/${courseId}/syllabus.pdf`;
}

/**
 * Object path for a course material's file. Both ids are server-generated
 * UUIDs, so the path can never contain user-controlled characters.
 */
export function courseMaterialObjectPath(
  courseId: string,
  materialId: string,
  mime: CourseFileMimeType,
): string {
  if (!UUID_RE.test(courseId) || !UUID_RE.test(materialId)) {
    throw new Error("courseMaterialObjectPath: ids must be UUIDs");
  }
  return `courses/${courseId}/materials/${materialId}/file.${extForCourseFileMime(mime)}`;
}
