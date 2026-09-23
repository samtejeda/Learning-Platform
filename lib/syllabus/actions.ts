"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth/session";
import { clearCourseSyllabus, findOwnedCourse, updateCourseSyllabus } from "@/lib/data/courses";
import {
  createCourseFileUploadUrl,
  getCourseFileInfo,
  isSyllabusMimeType,
  removeCourseFileObjects,
  syllabusObjectPath,
  COURSE_FILES_BUCKET,
  StorageError,
} from "@/lib/storage";
import { logger } from "@/lib/logger";
import { parseObject, type ActionState } from "@/lib/validation/form";
import { uploadSyllabusSchema, uuidSchema } from "@/lib/validation/syllabus";

// Upload flow (see API.md), same shape as lectures but with no publish step
// — uploading is publishing:
//   1. uploadSyllabus          → one-time signed upload token for the
//                                 course's fixed syllabus.pdf path
//   2. browser                 → uploadToSignedUrl(path, token, file)
//   3. finalizeSyllabusUpload  → server confirms the object exists and is a
//                                 real PDF, records it on the course row
// Every step re-validates the course id and re-checks ownership; nothing
// trusts the previous step's client-side state.

const NOT_FOUND = "Course not found.";

export type SyllabusUploadTicket =
  | { ok: true; courseId: string; bucket: string; path: string; token: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Step 1: hand back a signed upload token for this course's fixed syllabus path. */
export async function uploadSyllabus(courseId: string, input: unknown): Promise<SyllabusUploadTicket> {
  const user = await assertRole("professor", "admin");

  const cid = uuidSchema.safeParse(courseId);
  if (!cid.success) return { ok: false, error: NOT_FOUND };
  const parsed = parseObject(uploadSyllabusSchema, (input ?? {}) as Record<string, unknown>);
  if (!parsed.ok) return { ok: false, error: parsed.state.error!, fieldErrors: parsed.state.fieldErrors };

  const owned = await findOwnedCourse(cid.data, user);
  if (!owned) return { ok: false, error: NOT_FOUND };

  const path = syllabusObjectPath(owned.id);
  try {
    const { token } = await createCourseFileUploadUrl(path);
    return { ok: true, courseId: owned.id, bucket: COURSE_FILES_BUCKET, path, token };
  } catch (err) {
    if (!(err instanceof StorageError)) throw err;
    return { ok: false, error: "Upload is unavailable right now. Please try again." };
  }
}

/** Step 3: confirm the object landed and is really a PDF, then record it. */
export async function finalizeSyllabusUpload(courseId: string): Promise<ActionState> {
  const user = await assertRole("professor", "admin");

  const cid = uuidSchema.safeParse(courseId);
  if (!cid.success) return { error: NOT_FOUND };
  const owned = await findOwnedCourse(cid.data, user);
  if (!owned) return { error: NOT_FOUND };

  const path = syllabusObjectPath(owned.id);
  let info;
  try {
    info = await getCourseFileInfo(path);
  } catch (err) {
    if (!(err instanceof StorageError)) throw err;
    return { error: "We couldn't verify the upload. Please try again." };
  }
  if (!info) return { error: "The PDF hasn't finished uploading yet." };
  if (!isSyllabusMimeType(info.contentType ?? "")) {
    // Something other than a PDF ended up at the path; refuse it.
    await removeCourseFileObjects([path]).catch(() => {});
    return { error: "That file isn't a PDF." };
  }

  await updateCourseSyllabus(owned.id, user, path);
  revalidatePath(`/professor/courses/${owned.id}`);
  revalidatePath(`/courses/${owned.id}`);
  return { success: "Syllabus uploaded." };
}

/** Remove the syllabus. Object removal is attempted first; if Storage is
 * unavailable the course row is still cleared (an orphaned object is
 * recoverable, an undeletable syllabus reference is not). */
export async function removeSyllabus(courseId: string): Promise<ActionState> {
  const user = await assertRole("professor", "admin");

  const cid = uuidSchema.safeParse(courseId);
  if (!cid.success) return { error: NOT_FOUND };
  const owned = await findOwnedCourse(cid.data, user);
  if (!owned) return { error: NOT_FOUND };

  const path = syllabusObjectPath(owned.id);
  try {
    await removeCourseFileObjects([path]);
  } catch (err) {
    logger.error("syllabus.orphaned_object_after_delete", { path, err });
  }
  await clearCourseSyllabus(owned.id, user);
  revalidatePath(`/professor/courses/${owned.id}`);
  revalidatePath(`/courses/${owned.id}`);
  return { success: "Syllabus removed." };
}
