import type { ComprehensionStatus } from "./comprehension";

// The ONE rule for "is this lecture locked for this student, and why" (pure,
// unit-tested). Every student-facing read (the list, the lecture view, the
// stream route, the progress route) gets its answer from lib/data/lecture-locks
// which feeds this function, so they cannot drift apart. Nothing is stored:
// locks are derived at read time, so reordering, un/publishing and toggling a
// question are re-evaluated immediately.
//
// Sam's model (2026-11-06 / 2026-11-09):
//  - A lecture's comprehension question, when ENABLED, must be CLEARED before
//    the NEXT lecture opens. Cleared = passed (any correct attempt) or
//    unlocked by the professor. Failing both attempts = blocked until unlocked.
//  - Mid-course exemption: a lecture the student has already started (a
//    progress row exists) is never locked.
//  - "Next" means the next PUBLISHED lecture by order; unpublished lectures are
//    not in the input at all.
//  - A lecture without an enabled question never locks its successor, and a
//    course with no questions never locks anything.
//  - Transitive: a lecture is also locked while the previous published lecture
//    is locked (unless started), so a locked lecture can't be skipped by
//    opening the one after it.
// Reason codes never carry question text or the key.

export type LockInput = {
  id: string;
  /** `lectures.comprehension_enabled`. */
  questionEnabled: boolean;
  /** The student has a progress row on this lecture (the exemption). */
  started: boolean;
  /** The student's lecture progress is completed (>= threshold). */
  completed: boolean;
  /** Derived from the student's attempts (history; an unlock doesn't change it). */
  question: ComprehensionStatus;
  /** A professor unlock exists for this student on this lecture. */
  unlocked: boolean;
};

export type DirectLockReason =
  /** The previous lecture has a question and isn't completed yet. */
  | "previous_not_completed"
  /** Completed, but the question isn't passed yet (attempts remain). */
  | "previous_question_pending"
  /** Both attempts wrong: the student must contact the teacher. */
  | "previous_question_blocked";

export type LockReason = DirectLockReason | "previous_locked";

export type LectureLock = {
  reason: LockReason;
  /**
   * A published lecture the student can already see: the one whose question
   * (or completion) is in the way. For `previous_locked` it is the root of the
   * chain, not the immediate predecessor.
   */
  afterLectureId: string;
  /** Why the root of the chain is locked; equals `reason` unless that is `previous_locked`. */
  cause: DirectLockReason;
};

/** Passed, or let through by the professor. */
export function isCleared(l: Pick<LockInput, "question" | "unlocked">): boolean {
  return l.question === "passed" || l.unlocked;
}

/**
 * Locks for a course's PUBLISHED lectures in display order. Returns a map from
 * lecture id to its lock, or null when open.
 */
export function evaluateLocks(ordered: readonly LockInput[]): Map<string, LectureLock | null> {
  const locks = new Map<string, LectureLock | null>();
  ordered.forEach((lecture, i) => {
    const prev = i > 0 ? ordered[i - 1] : undefined;
    if (!prev || lecture.started) {
      locks.set(lecture.id, null);
      return;
    }
    if (prev.questionEnabled && !isCleared(prev)) {
      const reason: DirectLockReason = !prev.completed
        ? "previous_not_completed"
        : prev.question === "blocked"
          ? "previous_question_blocked"
          : "previous_question_pending";
      locks.set(lecture.id, { reason, afterLectureId: prev.id, cause: reason });
      return;
    }
    const prevLock = locks.get(prev.id);
    if (prevLock) {
      locks.set(lecture.id, { reason: "previous_locked", afterLectureId: prevLock.afterLectureId, cause: prevLock.cause });
      return;
    }
    locks.set(lecture.id, null);
  });
  return locks;
}
