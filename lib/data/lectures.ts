import "server-only";

import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { lectureProgress, lectures } from "@/lib/db/schema";

// Lecture reads. Student functions require enrollment AND publication in
// the query; professor functions are called only after findOwnedCourse.

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
