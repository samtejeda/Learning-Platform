import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { enrollments, lectureProgress, lectures } from "@/lib/db/schema";
import {
  applySegment,
  mergeIntervals,
  percentWatched,
  type ApplyResult,
  type Interval,
  type Segment,
} from "@/lib/progress/policy";
import { storedIntervalsSchema } from "@/lib/validation/progress";
import type { Actor } from "./courses";
import { getOwnedLecture } from "./lectures";

// Viewer-side lecture access and progress. Access rules live in the query:
// a student needs an enrollment in the lecture's course AND the lecture
// must be published; a professor/admin who owns the course may view any
// status (preview) but never accrues progress.

export type LectureView = {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  videoStoragePath: string;
  /** True when the viewer is an enrolled student whose progress is tracked. */
  tracksProgress: boolean;
  progress: ProgressView;
};

export type ProgressView = {
  intervals: Interval[];
  watchedSeconds: number;
  lastPositionSeconds: number;
  percent: number;
  completed: boolean;
};

const EMPTY_PROGRESS: ProgressView = {
  intervals: [],
  watchedSeconds: 0,
  lastPositionSeconds: 0,
  percent: 0,
  completed: false,
};

const lectureColumns = {
  id: lectures.id,
  courseId: lectures.courseId,
  title: lectures.title,
  description: lectures.description,
  durationSeconds: lectures.durationSeconds,
  videoStoragePath: lectures.videoStoragePath,
};

/** Published lecture the student is enrolled for, with their progress. */
async function getLectureForEnrolledStudent(lectureId: string, studentId: string) {
  const [row] = await db
    .select({
      ...lectureColumns,
      intervals: lectureProgress.watchedIntervals,
      watchedSeconds: lectureProgress.watchedSeconds,
      lastPositionSeconds: lectureProgress.lastPositionSeconds,
      completed: lectureProgress.completed,
    })
    .from(lectures)
    .innerJoin(
      enrollments,
      and(eq(enrollments.courseId, lectures.courseId), eq(enrollments.studentId, studentId)),
    )
    .leftJoin(
      lectureProgress,
      and(eq(lectureProgress.lectureId, lectures.id), eq(lectureProgress.studentId, studentId)),
    )
    .where(and(eq(lectures.id, lectureId), isNotNull(lectures.publishedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * What the viewer may see of a lecture, or null. Students: enrolled +
 * published. Professors/admins: their own course, any status (preview).
 * A professor who is also enrolled somewhere is treated as a student for
 * that course only if they are not its owner.
 */
export async function getLectureForViewer(lectureId: string, actor: Actor): Promise<LectureView | null> {
  if (actor.role === "professor" || actor.role === "admin") {
    const owned = await getOwnedLecture(lectureId, actor);
    if (owned) {
      return {
        id: owned.id,
        courseId: owned.courseId,
        title: owned.title,
        description: owned.description,
        durationSeconds: owned.durationSeconds,
        videoStoragePath: owned.videoStoragePath,
        tracksProgress: false,
        progress: EMPTY_PROGRESS,
      };
    }
  }
  const row = await getLectureForEnrolledStudent(lectureId, actor.id);
  if (!row) return null;
  const intervals = mergeIntervals(storedIntervalsSchema.parse(row.intervals ?? []));
  return {
    id: row.id,
    courseId: row.courseId,
    title: row.title,
    description: row.description,
    durationSeconds: row.durationSeconds,
    videoStoragePath: row.videoStoragePath,
    tracksProgress: true,
    progress: {
      intervals,
      watchedSeconds: row.watchedSeconds ?? 0,
      lastPositionSeconds: row.lastPositionSeconds ?? 0,
      percent: percentWatched(row.watchedSeconds ?? 0, row.durationSeconds),
      completed: row.completed ?? false,
    },
  };
}

export type RecordResult =
  | { ok: true; progress: ProgressView; justCompleted: boolean }
  | { ok: false; reason: "not_found" | "no_duration" | Exclude<ApplyResult, { ok: true }>["reason"] };

/**
 * Apply one watched segment for an enrolled student. Runs in a transaction
 * with the progress row locked (SELECT … FOR UPDATE) so concurrent pings
 * from two tabs can't double-count. Enrollment + publication are checked
 * inside the same transaction.
 */
export async function recordProgress(
  lectureId: string,
  studentId: string,
  segment: Segment,
  position: number | undefined,
  now: Date = new Date(),
): Promise<RecordResult> {
  return db.transaction(async (tx) => {
    const [lecture] = await tx
      .select({ id: lectures.id, durationSeconds: lectures.durationSeconds, threshold: lectures.completionThreshold })
      .from(lectures)
      .innerJoin(
        enrollments,
        and(eq(enrollments.courseId, lectures.courseId), eq(enrollments.studentId, studentId)),
      )
      .where(and(eq(lectures.id, lectureId), isNotNull(lectures.publishedAt)))
      .limit(1);
    if (!lecture) return { ok: false, reason: "not_found" };
    if (!lecture.durationSeconds || lecture.durationSeconds <= 0) return { ok: false, reason: "no_duration" };

    await tx
      .insert(lectureProgress)
      .values({ studentId, lectureId })
      .onConflictDoNothing({ target: [lectureProgress.studentId, lectureProgress.lectureId] });

    const [row] = await tx
      .select({
        id: lectureProgress.id,
        intervals: lectureProgress.watchedIntervals,
        watchedSeconds: lectureProgress.watchedSeconds,
        completed: lectureProgress.completed,
        lastUpdated: lectureProgress.lastUpdated,
        lastPositionSeconds: lectureProgress.lastPositionSeconds,
      })
      .from(lectureProgress)
      .where(and(eq(lectureProgress.studentId, studentId), eq(lectureProgress.lectureId, lectureId)))
      .for("update");

    const state = {
      intervals: storedIntervalsSchema.parse(row.intervals ?? []),
      watchedSeconds: row.watchedSeconds,
      completed: row.completed,
      // A freshly inserted row has lastUpdated = now; treat "no intervals
      // yet" as "no previous ping" so the first segment isn't rate-limited.
      lastUpdated: (row.intervals as unknown[])?.length ? row.lastUpdated : null,
    };
    const result = applySegment(state, segment, {
      durationSeconds: lecture.durationSeconds,
      thresholdPercent: lecture.threshold,
      now,
    });

    const nextPosition = clampPosition(position ?? segment.to, lecture.durationSeconds);

    if (!result.ok) {
      // Still remember where they are; nothing else changes.
      await tx
        .update(lectureProgress)
        .set({ lastPositionSeconds: nextPosition })
        .where(eq(lectureProgress.id, row.id));
      return { ok: false, reason: result.reason };
    }

    await tx
      .update(lectureProgress)
      .set({
        watchedIntervals: result.state.intervals,
        watchedSeconds: result.state.watchedSeconds,
        completed: result.state.completed,
        completedAt: result.justCompleted ? now : undefined,
        lastPositionSeconds: nextPosition,
        lastUpdated: now,
      })
      .where(eq(lectureProgress.id, row.id));

    return {
      ok: true,
      justCompleted: result.justCompleted,
      progress: {
        intervals: result.state.intervals,
        watchedSeconds: result.state.watchedSeconds,
        lastPositionSeconds: nextPosition,
        percent: percentWatched(result.state.watchedSeconds, lecture.durationSeconds),
        completed: result.state.completed,
      },
    };
  });
}

function clampPosition(p: number, duration: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(Math.max(0, p), duration);
}
