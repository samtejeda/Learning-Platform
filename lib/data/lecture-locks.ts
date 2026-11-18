import "server-only";

import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  lectureComprehensionAttempts,
  lectureComprehensionUnlocks,
  lectureProgress,
  lectures,
} from "@/lib/db/schema";
import { deriveComprehensionState } from "@/lib/lectures/comprehension";
import { evaluateLocks, type LectureLock, type LockInput } from "@/lib/lectures/lock-rules";

// THE single query helper for "is this lecture locked for this student".
// Every student-facing read goes through here (the course list, the lecture
// view that the page and the stream route share, and recordProgress), and the
// answer comes from the pure rule in lib/lectures/lock-rules.ts, so the places
// that enforce locking cannot disagree. Callers have already established that
// the student is enrolled; this reads only that student's own rows.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;

/**
 * Locks for every PUBLISHED lecture in the course, keyed by lecture id (null =
 * open). Four small queries, nothing stored: reordering, un/publishing and
 * toggling a question are therefore re-evaluated on the next read.
 */
export async function getStudentLectureLocks(
  executor: Executor,
  courseId: string,
  studentId: string,
): Promise<Map<string, LectureLock | null>> {
  const [published, progress, attempts, unlocks] = await Promise.all([
    executor
      .select({ id: lectures.id, questionEnabled: lectures.comprehensionEnabled })
      .from(lectures)
      .where(and(eq(lectures.courseId, courseId), isNotNull(lectures.publishedAt)))
      // Same order the lists use (order, then createdAt); id only breaks exact ties.
      .orderBy(asc(lectures.order), asc(lectures.createdAt), asc(lectures.id)),
    executor
      .select({ lectureId: lectureProgress.lectureId, completed: lectureProgress.completed })
      .from(lectureProgress)
      .innerJoin(lectures, eq(lectureProgress.lectureId, lectures.id))
      .where(and(eq(lectures.courseId, courseId), eq(lectureProgress.studentId, studentId))),
    executor
      .select({
        lectureId: lectureComprehensionAttempts.lectureId,
        attemptNumber: lectureComprehensionAttempts.attemptNumber,
        correct: lectureComprehensionAttempts.correct,
      })
      .from(lectureComprehensionAttempts)
      .innerJoin(lectures, eq(lectureComprehensionAttempts.lectureId, lectures.id))
      .where(and(eq(lectures.courseId, courseId), eq(lectureComprehensionAttempts.studentId, studentId))),
    executor
      .select({ lectureId: lectureComprehensionUnlocks.lectureId })
      .from(lectureComprehensionUnlocks)
      .innerJoin(lectures, eq(lectureComprehensionUnlocks.lectureId, lectures.id))
      .where(and(eq(lectures.courseId, courseId), eq(lectureComprehensionUnlocks.studentId, studentId))),
  ]);

  const progressBy = new Map(progress.map((p) => [p.lectureId, p.completed]));
  const unlocked = new Set(unlocks.map((u) => u.lectureId));
  const attemptsBy = new Map<string, { attemptNumber: number; correct: boolean }[]>();
  for (const a of attempts) {
    const list = attemptsBy.get(a.lectureId) ?? [];
    list.push({ attemptNumber: a.attemptNumber, correct: a.correct });
    attemptsBy.set(a.lectureId, list);
  }

  const input: LockInput[] = published.map((l) => ({
    id: l.id,
    questionEnabled: l.questionEnabled,
    started: progressBy.has(l.id),
    completed: progressBy.get(l.id) ?? false,
    question: deriveComprehensionState(attemptsBy.get(l.id) ?? []).status,
    unlocked: unlocked.has(l.id),
  }));
  return evaluateLocks(input);
}
