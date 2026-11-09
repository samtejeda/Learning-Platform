import "server-only";

import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  courses,
  enrollments,
  lectureComprehensionAttempts,
  lectureComprehensionQuestions,
  lectureProgress,
  lectures,
} from "@/lib/db/schema";
import { asStringArray } from "@/lib/exams/language";
import {
  comprehensionProblems,
  deriveComprehensionState,
  slotForAttempt,
  usableSlots,
  type ComprehensionProblem,
  type ComprehensionStatus,
  type NormalizedSlot,
} from "@/lib/lectures/comprehension";
import type { Actor } from "./courses";

// Per-lecture comprehension question (Sam, 2026-11-06 / 2026-11-09).
//
// KEY HANDLING: `lecture_comprehension_questions.correct_option` is read in
// exactly one place that returns it: `getOwnedComprehension` (professor DTO,
// ownership joined in the query). Student paths never select it; the answer is
// compared inside SQL and only a boolean comes back, exactly like exam keys.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ─── Professor side ───────────────────────────────────────────────────────────

export type OwnedComprehensionQuestion = {
  slot: number;
  promptEs: string | null;
  promptEn: string | null;
  optionsEs: string[];
  optionsEn: string[];
  correctOption: number | null;
};

export type OwnedComprehension = {
  lectureId: string;
  courseId: string;
  enabled: boolean;
  published: boolean;
  questions: OwnedComprehensionQuestion[];
};

function ownershipWhere(lectureId: string, actor: Actor) {
  return actor.role === "admin"
    ? eq(lectures.id, lectureId)
    : and(eq(lectures.id, lectureId), eq(courses.professorId, actor.id));
}

/** The lecture's question settings including the key, if the actor may manage its course. */
export async function getOwnedComprehension(lectureId: string, actor: Actor): Promise<OwnedComprehension | null> {
  const [lecture] = await db
    .select({
      lectureId: lectures.id,
      courseId: lectures.courseId,
      enabled: lectures.comprehensionEnabled,
      publishedAt: lectures.publishedAt,
    })
    .from(lectures)
    .innerJoin(courses, eq(lectures.courseId, courses.id))
    .where(ownershipWhere(lectureId, actor))
    .limit(1);
  if (!lecture) return null;
  const rows = await db
    .select({
      slot: lectureComprehensionQuestions.slot,
      promptEs: lectureComprehensionQuestions.promptEs,
      promptEn: lectureComprehensionQuestions.promptEn,
      optionsEs: lectureComprehensionQuestions.optionsEs,
      optionsEn: lectureComprehensionQuestions.optionsEn,
      correctOption: lectureComprehensionQuestions.correctOption,
    })
    .from(lectureComprehensionQuestions)
    .where(eq(lectureComprehensionQuestions.lectureId, lectureId))
    .orderBy(asc(lectureComprehensionQuestions.slot));
  return {
    lectureId: lecture.lectureId,
    courseId: lecture.courseId,
    enabled: lecture.enabled,
    published: lecture.publishedAt !== null,
    questions: rows.map((r) => ({
      ...r,
      optionsEs: asStringArray(r.optionsEs),
      optionsEn: asStringArray(r.optionsEn),
    })),
  };
}

export type ComprehensionEditResult =
  | { ok: true; courseId: string; enabled: boolean }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "incomplete"; problems: ComprehensionProblem[] };

class Rollback extends Error {}

/** Lock the lecture row (ownership joined) for the length of a transaction. */
async function lockOwnedLecture(tx: Tx, lectureId: string, actor: Actor) {
  const [row] = await tx
    .select({ id: lectures.id, courseId: lectures.courseId, enabled: lectures.comprehensionEnabled })
    .from(lectures)
    .innerJoin(courses, eq(lectures.courseId, courses.id))
    .where(ownershipWhere(lectureId, actor))
    .for("update", { of: lectures })
    .limit(1);
  return row ?? null;
}

async function currentProblems(tx: Tx | typeof db, lectureId: string): Promise<ComprehensionProblem[]> {
  const rows = await tx
    .select({
      slot: lectureComprehensionQuestions.slot,
      promptEs: lectureComprehensionQuestions.promptEs,
      promptEn: lectureComprehensionQuestions.promptEn,
      optionsEs: lectureComprehensionQuestions.optionsEs,
      optionsEn: lectureComprehensionQuestions.optionsEn,
      correctOption: lectureComprehensionQuestions.correctOption,
    })
    .from(lectureComprehensionQuestions)
    .where(eq(lectureComprehensionQuestions.lectureId, lectureId));
  return comprehensionProblems(rows);
}

/**
 * Replace both slots with what the professor typed. A blank slot removes its
 * row. If the question is currently ENABLED, the gate runs on the post-edit
 * state inside this transaction; a failing edit is rolled back and rejected,
 * never auto-disabled (the exams rule).
 */
export async function saveOwnedComprehension(
  lectureId: string,
  actor: Actor,
  slots: readonly [NormalizedSlot, NormalizedSlot],
): Promise<ComprehensionEditResult> {
  try {
    return await db.transaction(async (tx) => {
      const lecture = await lockOwnedLecture(tx, lectureId, actor);
      if (!lecture) return { ok: false, reason: "not_found" } as const;

      for (const [i, s] of slots.entries()) {
        const slot = i + 1;
        if (s.kind === "blank") {
          await tx
            .delete(lectureComprehensionQuestions)
            .where(and(eq(lectureComprehensionQuestions.lectureId, lecture.id), eq(lectureComprehensionQuestions.slot, slot)));
        } else {
          await tx
            .insert(lectureComprehensionQuestions)
            .values({ lectureId: lecture.id, slot, ...s.columns })
            .onConflictDoUpdate({
              target: [lectureComprehensionQuestions.lectureId, lectureComprehensionQuestions.slot],
              set: { ...s.columns, updatedAt: new Date() },
            });
        }
      }

      if (lecture.enabled) {
        const problems = await currentProblems(tx, lecture.id);
        if (problems.length > 0) {
          throw Object.assign(new Rollback("incomplete"), { problems });
        }
      }
      await tx.update(lectures).set({ updatedAt: new Date() }).where(eq(lectures.id, lecture.id));
      return { ok: true, courseId: lecture.courseId, enabled: lecture.enabled } as const;
    });
  } catch (err) {
    if (err instanceof Rollback) {
      return { ok: false, reason: "incomplete", problems: (err as Rollback & { problems: ComprehensionProblem[] }).problems };
    }
    throw err;
  }
}

/**
 * Turn the question on or off. Enabling re-runs the gate; disabling is always
 * allowed and changes only the flag (the written questions are kept).
 */
export async function setOwnedComprehensionEnabled(
  lectureId: string,
  actor: Actor,
  enabled: boolean,
): Promise<ComprehensionEditResult> {
  return db.transaction(async (tx) => {
    const lecture = await lockOwnedLecture(tx, lectureId, actor);
    if (!lecture) return { ok: false, reason: "not_found" } as const;
    if (enabled) {
      const problems = await currentProblems(tx, lecture.id);
      if (problems.length > 0) return { ok: false, reason: "incomplete", problems } as const;
    }
    await tx
      .update(lectures)
      .set({ comprehensionEnabled: enabled, updatedAt: new Date() })
      .where(eq(lectures.id, lecture.id));
    return { ok: true, courseId: lecture.courseId, enabled } as const;
  });
}

/**
 * Publish gate, run inside the publish transaction (the caller has locked the
 * lecture row): a lecture whose question is enabled cannot be published unless
 * the question is complete in both languages. Disabled = no constraint.
 */
export async function comprehensionAllowsPublish(tx: Tx, lectureId: string): Promise<boolean> {
  const [row] = await tx
    .select({ enabled: lectures.comprehensionEnabled })
    .from(lectures)
    .where(eq(lectures.id, lectureId))
    .limit(1);
  if (!row || !row.enabled) return true;
  return (await currentProblems(tx, lectureId)).length === 0;
}

/** For the publish action's message (read-only, no lock). */
export async function comprehensionPublishProblems(lectureId: string): Promise<ComprehensionProblem[]> {
  const [row] = await db
    .select({ enabled: lectures.comprehensionEnabled })
    .from(lectures)
    .where(eq(lectures.id, lectureId))
    .limit(1);
  if (!row?.enabled) return [];
  return currentProblems(db, lectureId);
}

// ─── Student side ─────────────────────────────────────────────────────────────

/** What a student reads: both languages (the wording is not secret; the key is). */
export type StudentComprehensionQuestion = {
  es: { prompt: string; options: string[] };
  en: { prompt: string; options: string[] };
};

export type StudentComprehension = {
  status: ComprehensionStatus;
  attemptsUsed: number;
  attemptsRemaining: number;
  /** The question can only be answered once the lecture is completed (server-validated). */
  lectureCompleted: boolean;
  /** The question for the next attempt: null when passed/blocked or the lecture isn't completed yet. */
  question: StudentComprehensionQuestion | null;
};

/** Enrolled + published + enabled, in ONE query; else null (the caller returns 404). */
async function getAccess(lectureId: string, studentId: string) {
  const [row] = await db
    .select({
      lectureId: lectures.id,
      completed: sql<boolean>`coalesce(${lectureProgress.completed}, false)`,
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
    .where(
      and(eq(lectures.id, lectureId), isNotNull(lectures.publishedAt), eq(lectures.comprehensionEnabled, true)),
    )
    .limit(1);
  return row ?? null;
}

async function studentAttempts(lectureId: string, studentId: string) {
  return db
    .select({
      attemptNumber: lectureComprehensionAttempts.attemptNumber,
      correct: lectureComprehensionAttempts.correct,
    })
    .from(lectureComprehensionAttempts)
    .where(
      and(eq(lectureComprehensionAttempts.lectureId, lectureId), eq(lectureComprehensionAttempts.studentId, studentId)),
    );
}

/** Student-facing question rows. The key column is deliberately NOT selected. */
async function studentQuestionRows(lectureId: string) {
  const rows = await db
    .select({
      slot: lectureComprehensionQuestions.slot,
      promptEs: lectureComprehensionQuestions.promptEs,
      promptEn: lectureComprehensionQuestions.promptEn,
      optionsEs: lectureComprehensionQuestions.optionsEs,
      optionsEn: lectureComprehensionQuestions.optionsEn,
    })
    .from(lectureComprehensionQuestions)
    .where(eq(lectureComprehensionQuestions.lectureId, lectureId));
  return rows.map((r) => ({
    slot: r.slot,
    promptEs: r.promptEs,
    promptEn: r.promptEn,
    optionsEs: asStringArray(r.optionsEs),
    optionsEn: asStringArray(r.optionsEn),
  }));
}
type StudentQuestionRow = Awaited<ReturnType<typeof studentQuestionRows>>[number];

function toStudentQuestion(r: StudentQuestionRow): StudentComprehensionQuestion {
  return {
    es: { prompt: r.promptEs ?? "", options: r.optionsEs },
    en: { prompt: r.promptEn ?? "", options: r.optionsEn },
  };
}

/** A usable question row needs a prompt and options in both languages. */
function isAskable(r: StudentQuestionRow | undefined): r is StudentQuestionRow {
  return !!r && !!r.promptEs && !!r.promptEn && r.optionsEs.length > 0 && r.optionsEs.length === r.optionsEn.length;
}

function questionForNextAttempt(rows: StudentQuestionRow[], nextAttempt: number): StudentQuestionRow | undefined {
  const slot = slotForAttempt(
    usableSlots(rows.map((r) => ({ ...r, correctOption: null }))),
    nextAttempt,
  );
  const row = rows.find((r) => r.slot === slot);
  return isAskable(row) ? row : undefined;
}

/**
 * The student's comprehension state for a lecture, or null when they have no
 * access (not enrolled, unpublished, question disabled, unknown id).
 */
export async function getComprehensionForStudent(
  lectureId: string,
  studentId: string,
): Promise<StudentComprehension | null> {
  const access = await getAccess(lectureId, studentId);
  if (!access) return null;
  const state = deriveComprehensionState(await studentAttempts(lectureId, studentId));
  let question: StudentComprehensionQuestion | null = null;
  if (access.completed && state.nextAttempt) {
    const row = questionForNextAttempt(await studentQuestionRows(lectureId), state.nextAttempt);
    question = row ? toStudentQuestion(row) : null;
  }
  return {
    status: state.status,
    attemptsUsed: state.attemptsUsed,
    attemptsRemaining: state.attemptsRemaining,
    lectureCompleted: access.completed,
    question,
  };
}

export type SubmitResult =
  | {
      ok: true;
      correct: boolean;
      status: ComprehensionStatus;
      attemptsRemaining: number;
      /** The next attempt's question when the student may retry, else null. */
      nextQuestion: StudentComprehensionQuestion | null;
    }
  | {
      ok: false;
      reason: "not_found" | "not_completed" | "already_passed" | "no_attempts_left" | "out_of_range" | "conflict";
    };

/**
 * Check one answer and record the attempt. Enrollment, publication and the
 * enabled flag are all part of the access query; the key is compared in SQL and
 * never selected. Stores only attempt number, question slot, right/wrong and a
 * timestamp (not the chosen option). The unique index makes a double submit a
 * "conflict" instead of a third attempt.
 */
export async function submitComprehensionAnswer(
  lectureId: string,
  studentId: string,
  selectedOption: number,
): Promise<SubmitResult> {
  const access = await getAccess(lectureId, studentId);
  if (!access) return { ok: false, reason: "not_found" };
  if (!access.completed) return { ok: false, reason: "not_completed" };

  const attempts = await studentAttempts(lectureId, studentId);
  const state = deriveComprehensionState(attempts);
  if (state.status === "passed") return { ok: false, reason: "already_passed" };
  if (state.status === "blocked" || !state.nextAttempt) return { ok: false, reason: "no_attempts_left" };

  const rows = await studentQuestionRows(lectureId);
  const asked = questionForNextAttempt(rows, state.nextAttempt);
  if (!asked) return { ok: false, reason: "not_found" };
  // Same count in both languages (askable), so one bound covers both.
  if (selectedOption >= asked.optionsEs.length) return { ok: false, reason: "out_of_range" };

  // Compared in SQL: the key never leaves the database.
  const [verdict] = await db
    .select({ correct: sql<boolean>`${lectureComprehensionQuestions.correctOption} = ${selectedOption}` })
    .from(lectureComprehensionQuestions)
    .where(
      and(eq(lectureComprehensionQuestions.lectureId, lectureId), eq(lectureComprehensionQuestions.slot, asked.slot)),
    )
    .limit(1);
  if (!verdict) return { ok: false, reason: "not_found" };
  const correct = verdict.correct === true;

  const inserted = await db
    .insert(lectureComprehensionAttempts)
    .values({ studentId, lectureId, attemptNumber: state.nextAttempt, questionSlot: asked.slot, correct })
    .onConflictDoNothing()
    .returning({ id: lectureComprehensionAttempts.id });
  if (inserted.length === 0) return { ok: false, reason: "conflict" };

  const after = deriveComprehensionState([...attempts, { attemptNumber: state.nextAttempt, correct }]);
  const next = after.nextAttempt ? questionForNextAttempt(rows, after.nextAttempt) : undefined;
  return {
    ok: true,
    correct,
    status: after.status,
    attemptsRemaining: after.attemptsRemaining,
    nextQuestion: next ? toStudentQuestion(next) : null,
  };
}
