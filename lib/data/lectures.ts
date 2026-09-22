import "server-only";

import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { courses, lectureProgress, lectures } from "@/lib/db/schema";
import type { Actor } from "./courses";

// Lecture reads and writes. Student functions require enrollment AND
// publication in the query; professor functions either run after
// findOwnedCourse or join the course ownership themselves (getOwnedLecture).

export type LectureStatus = "pending_upload" | "draft" | "published";

export type ProfessorLecture = {
  id: string;
  title: string;
  description: string | null;
  order: number;
  durationSeconds: number | null;
  status: LectureStatus;
};

export type StudentLecture = {
  id: string;
  title: string;
  description: string | null;
  order: number;
  durationSeconds: number | null;
  /** 0–100, from the server-validated watched coverage. */
  percentWatched: number;
  completed: boolean;
};

function statusOf(row: { videoUploadedAt: Date | null; publishedAt: Date | null }): LectureStatus {
  if (row.publishedAt) return "published";
  if (row.videoUploadedAt) return "draft";
  return "pending_upload";
}

/** Every lecture in a course, any status. Caller has verified ownership. */
export async function listLecturesForProfessor(courseId: string): Promise<ProfessorLecture[]> {
  const rows = await db
    .select({
      id: lectures.id,
      title: lectures.title,
      description: lectures.description,
      order: lectures.order,
      durationSeconds: lectures.durationSeconds,
      videoUploadedAt: lectures.videoUploadedAt,
      publishedAt: lectures.publishedAt,
    })
    .from(lectures)
    .where(eq(lectures.courseId, courseId))
    .orderBy(asc(lectures.order), asc(lectures.createdAt));
  return rows.map(({ videoUploadedAt, publishedAt, ...rest }) => ({
    ...rest,
    status: statusOf({ videoUploadedAt, publishedAt }),
  }));
}

/**
 * Published lectures with the student's own progress. Caller has verified
 * enrollment (getCourseForStudent); the published filter lives here so a
 * draft can never leak into a student list.
 */
export async function listPublishedLecturesForStudent(
  courseId: string,
  studentId: string,
): Promise<StudentLecture[]> {
  const rows = await db
    .select({
      id: lectures.id,
      title: lectures.title,
      description: lectures.description,
      order: lectures.order,
      durationSeconds: lectures.durationSeconds,
      watchedSeconds: sql<number>`coalesce(${lectureProgress.watchedSeconds}, 0)`,
      completed: sql<boolean>`coalesce(${lectureProgress.completed}, false)`,
    })
    .from(lectures)
    .leftJoin(
      lectureProgress,
      and(eq(lectureProgress.lectureId, lectures.id), eq(lectureProgress.studentId, studentId)),
    )
    .where(and(eq(lectures.courseId, courseId), isNotNull(lectures.publishedAt)))
    .orderBy(asc(lectures.order), asc(lectures.createdAt));
  return rows.map(({ watchedSeconds, ...rest }) => ({
    ...rest,
    percentWatched: percent(watchedSeconds, rest.durationSeconds),
  }));
}

function percent(watched: number, duration: number | null): number {
  if (!duration || duration <= 0) return 0;
  return Math.min(100, Math.round((watched / duration) * 100));
}

// ─── Professor-side single lecture (ownership joined) ─────────────────────────

export type OwnedLecture = {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  videoStoragePath: string;
  durationSeconds: number | null;
  videoUploadedAt: Date | null;
  publishedAt: Date | null;
  status: LectureStatus;
};

/**
 * The lecture if the actor may manage its course (professor = own course,
 * admin = any), else null. Ownership is part of the query so a lecture id
 * alone never grants access.
 */
export async function getOwnedLecture(lectureId: string, actor: Actor): Promise<OwnedLecture | null> {
  const ownership =
    actor.role === "admin"
      ? eq(lectures.id, lectureId)
      : and(eq(lectures.id, lectureId), eq(courses.professorId, actor.id));
  const [row] = await db
    .select({
      id: lectures.id,
      courseId: lectures.courseId,
      title: lectures.title,
      description: lectures.description,
      videoStoragePath: lectures.videoStoragePath,
      durationSeconds: lectures.durationSeconds,
      videoUploadedAt: lectures.videoUploadedAt,
      publishedAt: lectures.publishedAt,
    })
    .from(lectures)
    .innerJoin(courses, eq(lectures.courseId, courses.id))
    .where(ownership)
    .limit(1);
  if (!row) return null;
  return { ...row, status: statusOf(row) };
}

// ─── Writes (caller has verified ownership of the course) ─────────────────────

/** Create a pending-upload row. `id` and `videoStoragePath` are generated
 * by the caller so the storage path can embed the lecture id. */
export async function insertLecture(input: {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  videoStoragePath: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${lectures.order}), -1) + 1` })
      .from(lectures)
      .where(eq(lectures.courseId, input.courseId));
    await tx.insert(lectures).values({ ...input, order: next });
  });
}

export async function markLectureUploaded(lectureId: string, durationSeconds: number): Promise<void> {
  await db
    .update(lectures)
    .set({ videoUploadedAt: new Date(), durationSeconds, updatedAt: new Date() })
    .where(eq(lectures.id, lectureId));
}

/** Publish only if the video is actually uploaded; returns false otherwise. */
export async function setLecturePublished(lectureId: string, published: boolean): Promise<boolean> {
  const rows = await db
    .update(lectures)
    .set({ publishedAt: published ? new Date() : null, updatedAt: new Date() })
    .where(published ? and(eq(lectures.id, lectureId), isNotNull(lectures.videoUploadedAt)) : eq(lectures.id, lectureId))
    .returning({ id: lectures.id });
  return rows.length > 0;
}

export async function updateLectureRow(
  lectureId: string,
  input: { title: string; description: string | null },
): Promise<void> {
  await db.update(lectures).set({ ...input, updatedAt: new Date() }).where(eq(lectures.id, lectureId));
}

/**
 * Apply a full new order. Every id must belong to the course and the list
 * must cover every lecture in it, otherwise nothing changes (returns
 * false). One transaction so a partial order can never be observed.
 */
export async function reorderCourseLectures(courseId: string, orderedIds: string[]): Promise<boolean> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: lectures.id })
      .from(lectures)
      .where(eq(lectures.courseId, courseId));
    const existingIds = new Set(existing.map((r) => r.id));
    if (existingIds.size !== orderedIds.length || !orderedIds.every((id) => existingIds.has(id))) {
      return false;
    }
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(lectures)
        .set({ order: index, updatedAt: new Date() })
        .where(and(eq(lectures.id, id), eq(lectures.courseId, courseId)));
    }
    return true;
  });
}

export async function deleteLectureRow(lectureId: string): Promise<void> {
  await db.delete(lectures).where(eq(lectures.id, lectureId));
}

/** Storage paths for a set of lectures (used for cleanup). */
export async function listStoragePaths(lectureIds: string[]): Promise<string[]> {
  if (lectureIds.length === 0) return [];
  const rows = await db
    .select({ path: lectures.videoStoragePath })
    .from(lectures)
    .where(inArray(lectures.id, lectureIds));
  return rows.map((r) => r.path);
}
