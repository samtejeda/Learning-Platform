"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { assertRole } from "@/lib/auth/session";
import { findOwnedCourse } from "@/lib/data/courses";
import {
  comprehensionPublishProblems,
  saveOwnedComprehension,
  setOwnedComprehensionEnabled,
  type ComprehensionEditResult,
} from "@/lib/data/lecture-comprehension";
import {
  deleteLectureRow,
  getOwnedLecture,
  insertLecture,
  insertYoutubeLecture,
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
  readLectureHead,
  removeObjects,
  StorageError,
} from "@/lib/storage";
import { evaluateEncode } from "@/lib/video/encode-policy";
import { probeMp4 } from "@/lib/video/mp4-probe";
import { normalizeSlot, type ComprehensionProblem } from "@/lib/lectures/comprehension";
import { comprehensionFormSchema } from "@/lib/validation/lecture-comprehension";
import { parseFormData, parseObject, type ActionState } from "@/lib/validation/form";
import {
  createLectureSchema,
  createYoutubeLectureSchema,
  finalizeLectureSchema,
  reorderLecturesSchema,
  updateLectureSchema,
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

export type YoutubeLectureResult =
  | { ok: true; lectureId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const NO_UPLOAD_FOR_YOUTUBE = "This lecture uses a YouTube video, so there is nothing to upload.";

/**
 * Create a lecture whose video is an embedded YouTube video (a draft). Only the
 * 11-character id is stored; the server never fetches the link. The duration is
 * supplied by the professor (read from the player in their browser, or typed)
 * and is the trusted completion denominator.
 */
export async function createYoutubeLecture(courseId: string, input: unknown): Promise<YoutubeLectureResult> {
  const user = await assertRole("professor", "admin");

  const cid = uuidSchema.safeParse(courseId);
  if (!cid.success) return { ok: false, error: "Course not found." };
  const parsed = parseObject(createYoutubeLectureSchema, (input ?? {}) as Record<string, unknown>);
  if (!parsed.ok) return { ok: false, error: parsed.state.error!, fieldErrors: parsed.state.fieldErrors };

  const owned = await findOwnedCourse(cid.data, user);
  if (!owned) return { ok: false, error: "Course not found." };

  const lectureId = randomUUID();
  await insertYoutubeLecture({
    id: lectureId,
    courseId: owned.id,
    title: parsed.data.title,
    description: parsed.data.description,
    youtubeVideoId: parsed.data.youtubeUrl,
    durationSeconds: parsed.data.durationSeconds,
  });
  revalidatePath(`/professor/courses/${owned.id}`);
  return { ok: true, lectureId };
}

/** Re-issue an upload token for a lecture whose upload never completed. */
export async function retryLectureUpload(lectureId: string): Promise<UploadTicket> {
  const lecture = await ownedLectureOrNull(lectureId);
  if (!lecture) return { ok: false, error: NOT_FOUND };
  if (lecture.videoSource === "youtube" || !lecture.videoStoragePath) {
    return { ok: false, error: NO_UPLOAD_FOR_YOUTUBE };
  }
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
  if (lecture.videoSource === "youtube" || !lecture.videoStoragePath) return { error: NO_UPLOAD_FOR_YOUTUBE };
  const storagePath = lecture.videoStoragePath;

  const parsed = parseObject(finalizeLectureSchema, (input ?? {}) as Record<string, unknown>);
  if (!parsed.ok) return parsed.state;

  let info;
  try {
    info = await getObjectInfo(storagePath);
  } catch (err) {
    if (!(err instanceof StorageError)) throw err;
    return { error: "We couldn't verify the upload. Please try again." };
  }
  if (!info) return { error: "The video hasn't finished uploading yet." };
  if (!isLectureMimeType(info.contentType ?? "")) {
    // Something other than an allowlisted video ended up at the path; refuse it.
    await removeObjects([storagePath]).catch(() => {});
    return { error: "That file isn't a supported video." };
  }

  // Server-side encode gate: read the real header instead of trusting the
  // browser. The probed duration replaces the client-reported one.
  let head: Uint8Array | null;
  try {
    head = await readLectureHead(storagePath);
  } catch (err) {
    if (!(err instanceof StorageError)) throw err;
    return { error: "We couldn't verify the upload. Please try again." };
  }
  if (!head) return { error: "We couldn't verify the upload. Please try again." };

  const probe = probeMp4(head, info.sizeBytes);
  if (!probe.ok) {
    await removeObjects([storagePath]).catch(() => {});
    logger.info("lecture.upload_rejected", { reason: probe.reason });
    return {
      error:
        probe.reason === "moov_not_in_head"
          ? "The video's index is at the end of the file, so it can't start playing quickly. Re-export with the preset in docs/ENCODING.md."
          : "That file isn't a valid MP4 video. Re-export with the preset in docs/ENCODING.md.",
    };
  }
  const verdict = evaluateEncode(probe.info);
  if (verdict.verdict === "reject") {
    await removeObjects([storagePath]).catch(() => {});
    logger.info("lecture.upload_rejected", {
      reason: "encode_policy",
      bitrateMbps: Math.round(probe.info.bitrateBps / 1e5) / 10,
      width: probe.info.width,
      height: probe.info.height,
      codec: probe.info.videoCodec,
      fastStart: probe.info.fastStart,
    });
    return { error: verdict.notes.join(" ") };
  }

  await markLectureUploaded(lecture.id, Math.max(1, Math.round(probe.info.durationSeconds)));
  revalidatePath(`/professor/courses/${lecture.courseId}`);
  const note = verdict.verdict === "warn" ? ` ${verdict.notes.join(" ")}` : "";
  return { success: `Video uploaded. Publish it when you're ready.${note}` };
}

// publish/unpublish/delete take only the bound id; useActionState's `prev`
// argument (and a form's FormData) are accepted and ignored at runtime.
export async function publishLecture(lectureId: string): Promise<ActionState> {
  const lecture = await ownedLectureOrNull(lectureId);
  if (!lecture) return { error: NOT_FOUND };
  if (!lecture.videoUploadedAt) return { error: "Upload a video before publishing." };
  // An enabled comprehension question must be complete in both languages
  // (re-checked under a lock inside setLecturePublished).
  const problems = await comprehensionPublishProblems(lecture.id);
  if (problems.length > 0) {
    return { error: `Finish the comprehension question or turn it off before publishing. ${describeProblems(problems)}` };
  }
  if (!(await setLecturePublished(lecture.id, true))) {
    return { error: "This lecture can't be published right now. Check the video and the comprehension question." };
  }
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
  const parsed = parseFormData(updateLectureSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { title, description, youtubeUrl, durationSeconds } = parsed.data;
  const changesVideo = youtubeUrl !== undefined || durationSeconds !== undefined;
  // The source is fixed at creation. Link and duration are editable on YouTube
  // lectures only (an uploaded lecture's duration is probed from the file).
  if (changesVideo && lecture.videoSource !== "youtube") {
    return { error: "The video link and duration can only be changed on a YouTube lecture." };
  }
  const written = await updateLectureRow(lecture.id, {
    title,
    description,
    ...(changesVideo ? { youtube: { videoId: youtubeUrl, durationSeconds } } : {}),
  });
  if (!written) return { error: NOT_FOUND };
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
  // A YouTube lecture has no Storage object; skip Storage entirely.
  if (lecture.videoStoragePath) {
    try {
      await removeObjects([lecture.videoStoragePath]);
    } catch (err) {
      console.error("[lectures] orphaned object after delete", lecture.videoStoragePath, err);
    }
  }
  await deleteLectureRow(lecture.id);
  revalidatePath(`/professor/courses/${lecture.courseId}`);
  return { success: "Lecture deleted." };
}

// ─── Comprehension question (professor) ───────────────────────────────────────
// Per-lecture, bilingual, multiple choice, up to two questions (slot 2 is the
// optional second-attempt question). Every action is role-gated and the
// ownership join lives in the data function's query, so a lecture id alone
// grants nothing; a lecture in someone else's course is indistinguishable from
// an unknown id. The wording is the professor's: nothing here writes or
// translates it.

function describeProblems(problems: ComprehensionProblem[]): string {
  return problems.map((p) => (p.slot ? `Question ${p.slot}: ${p.message}` : p.message)).join(" ");
}

function editResultToState(result: ComprehensionEditResult, success: string): ActionState {
  if (!result.ok) {
    return result.reason === "not_found"
      ? { error: NOT_FOUND }
      : { error: `The comprehension question isn't complete. ${describeProblems(result.problems)}` };
  }
  revalidatePath(`/professor/courses/${result.courseId}`);
  return { success };
}

/** Set or edit the wording, options and key of both slots. Drafts may be incomplete. */
export async function saveLectureComprehension(
  lectureId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(lectureId);
  if (!id.success) return { error: NOT_FOUND };
  const parsed = parseFormData(comprehensionFormSchema, formData);
  if (!parsed.ok) return parsed.state;

  const first = normalizeSlot(1, parsed.data.slots[0]);
  if (!first.ok) return { error: first.error };
  const second = normalizeSlot(2, parsed.data.slots[1]);
  if (!second.ok) return { error: second.error };

  const result = await saveOwnedComprehension(id.data, user, [first.value, second.value]);
  return editResultToState(result, "Comprehension question saved.");
}

/** Turn the question on. Refused unless it is complete in both languages. */
export async function enableLectureComprehension(lectureId: string): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(lectureId);
  if (!id.success) return { error: NOT_FOUND };
  return editResultToState(await setOwnedComprehensionEnabled(id.data, user, true), "Comprehension question turned on.");
}

/** Turn the question off. The written question is kept, so turning it back on loses nothing. */
export async function disableLectureComprehension(lectureId: string): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(lectureId);
  if (!id.success) return { error: NOT_FOUND };
  return editResultToState(await setOwnedComprehensionEnabled(id.data, user, false), "Comprehension question turned off.");
}
