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
import type { LectureLock } from "@/lib/lectures/lock-rules";
import type { Actor } from "./courses";
import { getStudentLectureLocks } from "./lecture-locks";
import { getOwnedLecture } from "./lectures";

// Viewer-side lecture access and progress. Access rules live in the query:
// a student needs an enrollment in the lecture's course AND the lecture
// must be published; a professor/admin who owns the course may view any
// status (preview) but never accrues progress.

/**
 * Where the viewer's player gets the video. Server-side only: the stream route
 * turns it into a signed URL or hands back the YouTube id; the lecture page
 * never passes it to the client.
 */
export type LectureVideo =
  | { source: "upload"; storagePath: string }
  | { source: "youtube"; videoId: string };

/** lectures_video_source_check guarantees the matching field is set. */
function videoOf(row: {
  videoSource: "upload" | "youtube";
  videoStoragePath: string | null;
  youtubeVideoId: string | null;
}): LectureVideo | null {
  if (row.videoSource === "youtube") {
    return row.youtubeVideoId ? { source: "youtube", videoId: row.youtubeVideoId } : null;
  }
  return row.videoStoragePath ? { source: "upload", storagePath: row.videoStoragePath } : null;
}

export type OpenLectureView = {
  locked: false;
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  video: LectureVideo;
  /** True when the viewer is an enrolled student whose progress is tracked. */
  tracksProgress: boolean;
  progress: ProgressView;
};

/**
 * A lecture the student is enrolled for and can see in their list, but may not
 * open yet (the previous lecture's comprehension question isn't cleared). It
 * deliberately has NO video, description or progress, so a caller that forgets
 * to handle `locked` cannot compile its way to a stream URL or a YouTube id.
 */
export type LockedLectureView = {
  locked: true;
  id: string;
  courseId: string;
  title: string;
  lock: LectureLock;
};

export type LectureView = OpenLectureView | LockedLectureView;

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
  videoSource: lectures.videoSource,
  videoStoragePath: lectures.videoStoragePath,
  youtubeVideoId: lectures.youtubeVideoId,
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
 * published, and a lecture locked by an earlier comprehension question comes
 * back as a LockedLectureView. Professors/admins: their own course, any
 * status (preview), never locked.
 * A professor who is also enrolled somewhere is treated as a student for
 * that course only if they are not its owner.
 */
export async function getLectureForViewer(lectureId: string, actor: Actor): Promise<LectureView | null> {
  if (actor.role === "professor" || actor.role === "admin") {
    const owned = await getOwnedLecture(lectureId, actor);
    const ownedVideo = owned && videoOf(owned);
    if (owned && ownedVideo) {
      return {
        locked: false,
        id: owned.id,
        courseId: owned.courseId,
        title: owned.title,
        description: owned.description,
        durationSeconds: owned.durationSeconds,
        video: ownedVideo,
        tracksProgress: false,
        progress: EMPTY_PROGRESS,
      };
    }
  }
  const row = await getLectureForEnrolledStudent(lectureId, actor.id);
  if (!row) return null;
  const video = videoOf(row);
  if (!video) return null;
  // A progress row means the student already started this lecture (the
  // mid-course exemption), so the lock query is only needed on a first visit.
  if (row.completed === null) {
    const lock = (await getStudentLectureLocks(db, row.courseId, actor.id)).get(row.id) ?? null;
    if (lock) return { locked: true, id: row.id, courseId: row.courseId, title: row.title, lock };
  }
  const intervals = mergeIntervals(storedIntervalsSchema.parse(row.intervals ?? []));
  return {
    locked: false,
    id: row.id,
    courseId: row.courseId,
    title: row.title,
    description: row.description,
    durationSeconds: row.durationSeconds,
    video,
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
  | { ok: false; reason: "not_found" | "locked" | "no_duration" | Exclude<ApplyResult, { ok: true }>["reason"] };

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
      .select({
        id: lectures.id,
        courseId: lectures.courseId,
        durationSeconds: lectures.durationSeconds,
        threshold: lectures.completionThreshold,
      })
      .from(lectures)
      .innerJoin(
        enrollments,
        and(eq(enrollments.courseId, lectures.courseId), eq(enrollments.studentId, studentId)),
      )
      .where(and(eq(lectures.id, lectureId), isNotNull(lectures.publishedAt)))
      .limit(1);
    if (!lecture) return { ok: false, reason: "not_found" };

    // Locked lectures take no progress. This MUST run before the insert below:
    // the progress row is what exempts a lecture from locking, so creating it
    // for a locked lecture would unlock it. A row that already exists means the
    // student started this lecture earlier, so the common ping skips the query.
    const [existing] = await tx
      .select({ id: lectureProgress.id })
      .from(lectureProgress)
      .where(and(eq(lectureProgress.studentId, studentId), eq(lectureProgress.lectureId, lectureId)))
      .limit(1);
    if (!existing) {
      const lock = (await getStudentLectureLocks(tx, lecture.courseId, studentId)).get(lecture.id);
      if (lock) return { ok: false, reason: "locked" };
    }

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
