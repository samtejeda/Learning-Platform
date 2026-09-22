"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth/session";
import { findOwnedCourse } from "@/lib/data/courses";
import {
  deleteLectureRow,
  getOwnedLecture,
  insertLecture,
  markLectureUploaded,
  reorderCourseLectures,
  setLecturePublished,
  updateLectureRow,
} from "@/lib/data/lectures";
import {
  createLectureUploadUrl,
  getObjectInfo,
  isLectureMimeType,
  lectureObjectPath,
  LECTURES_BUCKET,
  removeObjects,
  StorageError,
} from "@/lib/storage";
import { parseFormData, parseObject, type ActionState } from "@/lib/validation/form";
import {
  createLectureSchema,
  finalizeLectureSchema,
  lectureFormSchema,
  reorderLecturesSchema,
  uuidSchema,
} from "@/lib/validation/lectures";

// Upload flow (see API.md):
//   1. createLecture      → pending row + one-time signed upload token
//   2. browser            → uploadToSignedUrl(path, token, file)   (no server hop)
//   3. finalizeLectureUpload → server confirms the object exists, records duration
//   4. publishLecture     → visible to enrolled students
// Every step re-validates its ids and re-checks ownership; nothing trusts
// the previous step's client-side state.

const NOT_FOUND = "Lecture not found.";

export type UploadTicket =
  | { ok: true; lectureId: string; bucket: string; path: string; token: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

async function ownedLectureOrNull(lectureId: string) {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(lectureId);
  if (!id.success) return null;
  return getOwnedLecture(id.data, user);
}

/** Step 1: create the lecture row and hand back a signed upload token. */
export async function createLecture(courseId: string, input: unknown): Promise<UploadTicket> {
  const user = await assertRole("professor", "admin");

  const cid = uuidSchema.safeParse(courseId);
  if (!cid.success) return { ok: false, error: "Course not found." };
  const parsed = parseObject(createLectureSchema, (input ?? {}) as Record<string, unknown>);
  if (!parsed.ok) return { ok: false, error: parsed.state.error!, fieldErrors: parsed.state.fieldErrors };

  const owned = await findOwnedCourse(cid.data, user);
  if (!owned) return { ok: false, error: "Course not found." };

  const lectureId = randomUUID();
  const path = lectureObjectPath(owned.id, lectureId, parsed.data.contentType);
  await insertLecture({
    id: lectureId,
    courseId: owned.id,
    title: parsed.data.title,
    description: parsed.data.description,
    videoStoragePath: path,
  });

  try {
    const { token } = await createLectureUploadUrl(path);
    revalidatePath(`/professor/courses/${owned.id}`);
    return { ok: true, lectureId, bucket: LECTURES_BUCKET, path, token };
  } catch (err) {
    if (!(err instanceof StorageError)) throw err;
    // Row stays as "pending upload" so the professor can retry or delete.
    revalidatePath(`/professor/courses/${owned.id}`);
    return { ok: false, error: "Upload is unavailable right now. Please try again." };
  }
}

/** Re-issue an upload token for a lecture whose upload never completed. */
export async function retryLectureUpload(lectureId: string): Promise<UploadTicket> {
  const lecture = await ownedLectureOrNull(lectureId);
  if (!lecture) return { ok: false, error: NOT_FOUND };
  if (lecture.videoUploadedAt) return { ok: false, error: "This lecture already has a video." };
  try {
    const { token } = await createLectureUploadUrl(lecture.videoStoragePath);
    return { ok: true, lectureId: lecture.id, bucket: LECTURES_BUCKET, path: lecture.videoStoragePath, token };
  } catch (err) {
    if (!(err instanceof StorageError)) throw err;
    return { ok: false, error: "Upload is unavailable right now. Please try again." };
  }
}

/** Step 3: confirm the object landed and record the duration. */
export async function finalizeLectureUpload(lectureId: string, input: unknown): Promise<ActionState> {
  const lecture = await ownedLectureOrNull(lectureId);
  if (!lecture) return { error: NOT_FOUND };

  const parsed = parseObject(finalizeLectureSchema, (input ?? {}) as Record<string, unknown>);
  if (!parsed.ok) return parsed.state;

  let info;
  try {
    info = await getObjectInfo(lecture.videoStoragePath);
  } catch (err) {
    if (!(err instanceof StorageError)) throw err;
    return { error: "We couldn't verify the upload. Please try again." };
  }
  if (!info) return { error: "The video hasn't finished uploading yet." };
  if (!isLectureMimeType(info.contentType ?? "")) {
    // Something other than an allowlisted video ended up at the path; refuse it.
    await removeObjects([lecture.videoStoragePath]).catch(() => {});
    return { error: "That file isn't a supported video." };
  }

  await markLectureUploaded(lecture.id, parsed.data.durationSeconds);
  revalidatePath(`/professor/courses/${lecture.courseId}`);
  return { success: "Video uploaded. Publish it when you're ready." };
}

// publish/unpublish/delete take only the bound id; useActionState's `prev`
// argument (and a form's FormData) are accepted and ignored at runtime.
export async function publishLecture(lectureId: string): Promise<ActionState> {
  const lecture = await ownedLectureOrNull(lectureId);
  if (!lecture) return { error: NOT_FOUND };
  if (!lecture.videoUploadedAt) return { error: "Upload a video before publishing." };
  await setLecturePublished(lecture.id, true);
  revalidatePath(`/professor/courses/${lecture.courseId}`);
  return { success: "Published." };
}

export async function unpublishLecture(lectureId: string): Promise<ActionState> {
  const lecture = await ownedLectureOrNull(lectureId);
  if (!lecture) return { error: NOT_FOUND };
  await setLecturePublished(lecture.id, false);
  revalidatePath(`/professor/courses/${lecture.courseId}`);
  return { success: "Unpublished." };
}

export async function updateLecture(
  lectureId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const lecture = await ownedLectureOrNull(lectureId);
  if (!lecture) return { error: NOT_FOUND };
  const parsed = parseFormData(lectureFormSchema, formData);
  if (!parsed.ok) return parsed.state;
  await updateLectureRow(lecture.id, parsed.data);
  revalidatePath(`/professor/courses/${lecture.courseId}`);
  redirect(`/professor/courses/${lecture.courseId}`);
}

/** Full new order for a course's lectures. */
export async function reorderLectures(courseId: string, input: unknown): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const cid = uuidSchema.safeParse(courseId);
  if (!cid.success) return { error: "Course not found." };
  const parsed = parseObject(reorderLecturesSchema, (input ?? {}) as Record<string, unknown>);
  if (!parsed.ok) return parsed.state;
  const owned = await findOwnedCourse(cid.data, user);
  if (!owned) return { error: "Course not found." };
  const ok = await reorderCourseLectures(owned.id, parsed.data.orderedIds);
  if (!ok) return { error: "The lecture list changed. Refresh and try again." };
  revalidatePath(`/professor/courses/${owned.id}`);
  return { success: "Order saved." };
}

/** Delete the row and its video. Object removal is attempted first; if
 * Storage is unavailable the row is still deleted (an orphaned object is
 * recoverable, an undeletable lecture is not) and the failure is logged. */
export async function deleteLecture(lectureId: string): Promise<ActionState> {
  const lecture = await ownedLectureOrNull(lectureId);
  if (!lecture) return { error: NOT_FOUND };
  try {
    await removeObjects([lecture.videoStoragePath]);
  } catch (err) {
    console.error("[lectures] orphaned object after delete", lecture.videoStoragePath, err);
  }
  await deleteLectureRow(lecture.id);
  revalidatePath(`/professor/courses/${lecture.courseId}`);
  return { success: "Lecture deleted." };
}
