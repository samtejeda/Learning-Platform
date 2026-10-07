import "server-only";

import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { courses, examAnswers, examQuestions, examSubmissions, exams, users } from "@/lib/db/schema";
import type { Actor } from "./courses";
import { examPublishProblems, type PublishProblem } from "@/lib/exams/publish-rules";
import { blankEditBlock, optionEditBlock, type AttemptBlock } from "@/lib/exams/edit-rules";
import { normalizeQuestionFields, type QuestionType } from "@/lib/exams/question";
import { scoreSubmissions } from "./exam-results";
import { gradeOfRecord, type AttemptScore } from "@/lib/exams/scoring";
import { asStringArray, type ContentLanguage } from "@/lib/exams/language";
import { MAX_QUESTIONS_PER_EXAM } from "@/lib/exams/limits";
import type { ExamFormInput, GradeInput, QuestionFieldsInput } from "@/lib/validation/exams";

// Professor-side exam reads and writes (authoring, publish gate, grading).
// Every function takes the acting user and joins course ownership into the
// query (professor = own course, admin = any). Student-side reads and the
// attempt lifecycle live in lib/data/exam-attempts.ts. Answer keys and
// reference answers appear ONLY in this file's professor DTOs.
//
// Lifecycle rules enforced here (not in the UI), per Sam's 2026-10-06 change:
//  - Exams are editable at ANY state (draft, published, attempts exist):
//    wording, keys, reference answers, titles, max_attempts, duration.
//  - Once attempts exist (any exam_submissions row), edits that would move or
//    drop a stored position are refused: delete/add/reorder questions,
//    add/remove/reorder multiple-choice options. Question type is immutable.
//  - Every edit to a PUBLISHED exam re-runs the bilingual publish gate in the
//    same transaction; a failing edit is rejected, never auto-unpublished.
//  - Unpublish is always allowed; delete only while there are no attempts.
//  - In-progress attempts see edits live (no snapshots).

export type ExamStatus = "draft" | "published";

function ownerCondition(examId: string, actor: Actor) {
  return actor.role === "admin"
    ? eq(exams.id, examId)
    : and(eq(exams.id, examId), eq(courses.professorId, actor.id));
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export type ProfessorExamSummary = {
  id: string;
  titleEs: string | null;
  titleEn: string | null;
  status: ExamStatus;
  questionCount: number;
  attemptCount: number;
  maxAttempts: number;
  durationMinutes: number;
  revealKeysAfterAttempts: boolean;
};

/** Every exam in a course, any status. Caller has verified ownership of the course. */
export async function listExamsForProfessor(courseId: string): Promise<ProfessorExamSummary[]> {
  const rows = await db
    .select({
      id: exams.id,
      titleEs: exams.titleEs,
      titleEn: exams.titleEn,
      publishedAt: exams.publishedAt,
      maxAttempts: exams.maxAttempts,
      durationMinutes: exams.durationMinutes,
      revealKeysAfterAttempts: exams.revealKeysAfterAttempts,
      questionCount: sql<number>`(select count(*)::int from ${examQuestions} q where q.exam_id = ${exams.id})`,
      attemptCount: sql<number>`(select count(*)::int from ${examSubmissions} s where s.exam_id = ${exams.id})`,
    })
    .from(exams)
    .where(eq(exams.courseId, courseId))
    .orderBy(asc(exams.createdAt));
  return rows.map(({ publishedAt, ...r }) => ({ ...r, status: publishedAt ? "published" : "draft" }));
}

export type ProfessorQuestion = {
  id: string;
  type: QuestionType;
  order: number;
  promptEs: string | null;
  promptEn: string | null;
  optionsEs: string[] | null;
  optionsEn: string[] | null;
  /** Answer key by position. Professor-only. */
  correctOption: number | null;
  referenceAnswerEs: string | null;
  referenceAnswerEn: string | null;
  /** Weight in points (1–100). */
  points: number;
};

export type OwnedExam = {
  id: string;
  courseId: string;
  titleEs: string | null;
  titleEn: string | null;
  descriptionEs: string | null;
  descriptionEn: string | null;
  maxAttempts: number;
  durationMinutes: number;
  revealKeysAfterAttempts: boolean;
  status: ExamStatus;
  attemptCount: number;
  questions: ProfessorQuestion[];
};

/** The exam (with questions and keys) if the actor may manage its course, else null. */
export async function getOwnedExam(examId: string, actor: Actor): Promise<OwnedExam | null> {
  const [row] = await db
    .select({
      id: exams.id,
      courseId: exams.courseId,
      titleEs: exams.titleEs,
      titleEn: exams.titleEn,
      descriptionEs: exams.descriptionEs,
      descriptionEn: exams.descriptionEn,
      maxAttempts: exams.maxAttempts,
      durationMinutes: exams.durationMinutes,
      revealKeysAfterAttempts: exams.revealKeysAfterAttempts,
      publishedAt: exams.publishedAt,
      attemptCount: sql<number>`(select count(*)::int from ${examSubmissions} s where s.exam_id = ${exams.id})`,
    })
    .from(exams)
    .innerJoin(courses, eq(exams.courseId, courses.id))
    .where(ownerCondition(examId, actor))
    .limit(1);
  if (!row) return null;
  const { publishedAt, ...rest } = row;
  const questions = await listQuestions(row.id);
  return { ...rest, status: publishedAt ? "published" : "draft", questions };
}

async function listQuestions(examId: string): Promise<ProfessorQuestion[]> {
  const rows = await db
    .select({
      id: examQuestions.id,
      type: examQuestions.type,
      order: examQuestions.order,
      promptEs: examQuestions.promptEs,
      promptEn: examQuestions.promptEn,
      optionsEs: examQuestions.optionsEs,
      optionsEn: examQuestions.optionsEn,
      correctOption: examQuestions.correctOption,
      referenceAnswerEs: examQuestions.referenceAnswerEs,
      referenceAnswerEn: examQuestions.referenceAnswerEn,
      points: examQuestions.points,
    })
    .from(examQuestions)
    .where(eq(examQuestions.examId, examId))
    .orderBy(asc(examQuestions.order), asc(examQuestions.createdAt));
  return rows.map((r) => ({
    ...r,
    optionsEs: r.type === "multiple_choice" ? asStringArray(r.optionsEs) : null,
    optionsEn: r.type === "multiple_choice" ? asStringArray(r.optionsEn) : null,
  }));
}

export type ProfessorSubmissionRow = {
  id: string;
  studentName: string | null;
  studentEmail: string | null;
  attemptNumber: number;
  language: ContentLanguage;
  startedAt: Date;
  submittedAt: Date | null;
  /** Derived at read time (auto points now, manual points once awarded). Null while in progress. */
  score: ProfessorScoreSummary | null;
  /** Final percent (0–100) of this attempt; null while in progress or pending manual grading. */
  grade: number | null;
  gradedAt: Date | null;
  /** Highest FINAL percent for this student on this exam (grade of record). */
  gradeOfRecord: number | null;
};

export type ProfessorScoreSummary = {
  status: "pending" | "final";
  legacy: boolean;
  autoPoints: number;
  autoMax: number;
  manualPoints: number;
  manualMax: number;
  totalPoints: number;
  totalMax: number;
  percent: number | null;
  provisionalPercent: number | null;
  /** Manual questions still needing points. */
  pendingCount: number;
};

function summarize(sc: AttemptScore): ProfessorScoreSummary {
  return {
    status: sc.status, legacy: sc.legacy, autoPoints: sc.autoPoints, autoMax: sc.autoMax,
    manualPoints: sc.manualPoints, manualMax: sc.manualMax, totalPoints: sc.totalPoints, totalMax: sc.totalMax,
    percent: sc.percent, provisionalPercent: sc.provisionalPercent, pendingCount: sc.pendingQuestionIds.length,
  };
}

/** Close every expired in-progress attempt for an exam (no cron: closed lazily on read). */
async function closeExpiredForExam(examId: string): Promise<void> {
  await db.execute(sql`
    update exam_submissions s
    set submitted_at = s.started_at + make_interval(mins => e.duration_minutes)
    from exams e
    where e.id = s.exam_id and s.exam_id = ${examId}::uuid and s.submitted_at is null
      and now() > s.started_at + make_interval(mins => e.duration_minutes)
  `);
}

/** Attempts for an exam (ownership joined). Null if not owned / not found. */
export async function listSubmissionsForExam(
  examId: string,
  actor: Actor,
): Promise<ProfessorSubmissionRow[] | null> {
  const [owned] = await db
    .select({ id: exams.id })
    .from(exams)
    .innerJoin(courses, eq(exams.courseId, courses.id))
    .where(ownerCondition(examId, actor))
    .limit(1);
  if (!owned) return null;
  await closeExpiredForExam(examId);
  const rows = await db
    .select({
      id: examSubmissions.id,
      studentId: examSubmissions.studentId,
      studentName: users.fullName,
      studentEmail: users.email,
      attemptNumber: examSubmissions.attemptNumber,
      language: examSubmissions.language,
      startedAt: examSubmissions.startedAt,
      submittedAt: examSubmissions.submittedAt,
      legacyGrade: examSubmissions.grade,
      gradedAt: examSubmissions.gradedAt,
    })
    .from(examSubmissions)
    .innerJoin(users, eq(examSubmissions.studentId, users.id))
    .where(eq(examSubmissions.examId, examId))
    .orderBy(asc(users.fullName), asc(users.email), asc(examSubmissions.attemptNumber));
  const scores = await scoreSubmissions(
    rows.filter((r) => r.submittedAt).map((r) => ({ id: r.id, examId, gradedAt: r.gradedAt, grade: r.legacyGrade })),
  );
  return rows.map(({ studentId, legacyGrade: _legacy, ...r }) => {
    const sc = scores.get(r.id) ?? null;
    return {
      ...r,
      score: sc ? summarize(sc) : null,
      grade: sc?.percent ?? null,
      gradeOfRecord: gradeOfRecord(rows.filter((x) => x.studentId === studentId && scores.has(x.id)).map((x) => scores.get(x.id)!)),
    };
  });
}

export type GradingAnswer = {
  questionId: string;
  order: number;
  type: QuestionType;
  /** Text in the language the student used. */
  prompt: string | null;
  options: string[] | null;
  /** Professor-only key and grading guide. */
  correctOption: number | null;
  referenceAnswer: string | null;
  selectedOption: number | null;
  answerText: string | null;
  /** Fill in the blank with blanks: the student's answer per blank, in blank order. */
  blanks: string[] | null;
  /** Weight in points. */
  points: number;
  /** Auto-scored: correct/incorrect/unanswered. Manual: awaiting/graded/unanswered. */
  state: "correct" | "incorrect" | "unanswered" | "awaiting" | "graded";
  /** Points earned on this question (auto: derived now; manual: awarded, 0 until graded). */
  pointsEarned: number;
  /** Manual questions only: the awarded points (null = not graded yet). */
  pointsAwarded: number | null;
  feedback: string | null;
};

export type SubmissionForGrading = {
  id: string;
  examId: string;
  courseId: string;
  examTitle: string | null;
  studentName: string | null;
  studentEmail: string | null;
  attemptNumber: number;
  language: ContentLanguage;
  submittedAt: Date;
  /** Overall feedback. */
  feedback: string | null;
  gradedAt: Date | null;
  score: ProfessorScoreSummary;
  answers: GradingAnswer[];
};

/** A submitted attempt with every question beside the student's answer. Ownership joined. */
export async function getSubmissionForGrading(
  submissionId: string,
  actor: Actor,
): Promise<SubmissionForGrading | null> {
  const ownership =
    actor.role === "admin"
      ? eq(examSubmissions.id, submissionId)
      : and(eq(examSubmissions.id, submissionId), eq(courses.professorId, actor.id));
  const [row] = await db
    .select({
      id: examSubmissions.id,
      examId: examSubmissions.examId,
      courseId: exams.courseId,
      titleEs: exams.titleEs,
      titleEn: exams.titleEn,
      studentName: users.fullName,
      studentEmail: users.email,
      attemptNumber: examSubmissions.attemptNumber,
      language: examSubmissions.language,
      submittedAt: examSubmissions.submittedAt,
      legacyGrade: examSubmissions.grade,
      feedback: examSubmissions.feedback,
      gradedAt: examSubmissions.gradedAt,
    })
    .from(examSubmissions)
    .innerJoin(exams, eq(examSubmissions.examId, exams.id))
    .innerJoin(courses, eq(exams.courseId, courses.id))
    .innerJoin(users, eq(examSubmissions.studentId, users.id))
    .where(ownership)
    .limit(1);
  if (!row) return null;
  await closeExpiredForExam(row.examId);
  const [fresh] = await db
    .select({ submittedAt: examSubmissions.submittedAt })
    .from(examSubmissions)
    .where(eq(examSubmissions.id, submissionId));
  if (!fresh?.submittedAt) return null; // still in progress: nothing to grade yet

  const lang = row.language;
  const qs = await db
    .select({
      id: examQuestions.id,
      order: examQuestions.order,
      type: examQuestions.type,
      promptEs: examQuestions.promptEs,
      promptEn: examQuestions.promptEn,
      optionsEs: examQuestions.optionsEs,
      optionsEn: examQuestions.optionsEn,
      correctOption: examQuestions.correctOption,
      referenceAnswerEs: examQuestions.referenceAnswerEs,
      referenceAnswerEn: examQuestions.referenceAnswerEn,
      points: examQuestions.points,
      selectedOption: examAnswers.selectedOption,
      answerText: examAnswers.answerText,
      blankAnswers: examAnswers.blankAnswers,
      pointsAwarded: examAnswers.pointsAwarded,
      feedback: examAnswers.feedback,
    })
    .from(examQuestions)
    .leftJoin(
      examAnswers,
      and(eq(examAnswers.questionId, examQuestions.id), eq(examAnswers.submissionId, submissionId)),
    )
    .where(eq(examQuestions.examId, row.examId))
    .orderBy(asc(examQuestions.order), asc(examQuestions.createdAt));

  const score = (await scoreSubmissions([{ id: row.id, examId: row.examId, gradedAt: row.gradedAt, grade: row.legacyGrade }])).get(row.id)!;
  const perQ = new Map(score.perQuestion.map((p) => [p.questionId, p]));

  return {
    id: row.id,
    examId: row.examId,
    courseId: row.courseId,
    examTitle: lang === "es" ? row.titleEs : row.titleEn,
    studentName: row.studentName,
    studentEmail: row.studentEmail,
    attemptNumber: row.attemptNumber,
    language: lang,
    submittedAt: fresh.submittedAt,
    feedback: row.feedback,
    gradedAt: row.gradedAt,
    score: summarize(score),
    answers: qs.map((q) => ({
      questionId: q.id,
      order: q.order,
      type: q.type,
      prompt: lang === "es" ? q.promptEs : q.promptEn,
      options: q.type === "multiple_choice" ? asStringArray(lang === "es" ? q.optionsEs : q.optionsEn) : null,
      correctOption: q.correctOption,
      referenceAnswer: lang === "es" ? q.referenceAnswerEs : q.referenceAnswerEn,
      selectedOption: q.selectedOption,
      answerText: q.answerText,
      blanks: asStringArray(q.blankAnswers).length ? asStringArray(q.blankAnswers) : null,
      points: q.points,
      state: perQ.get(q.id)!.state,
      pointsEarned: perQ.get(q.id)!.points,
      pointsAwarded: q.type === "multiple_choice" || q.type === "true_false" ? null : q.pointsAwarded,
      feedback: q.feedback,
    })),
  };
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export type WriteResult = "ok" | "not_found";

export type EditOutcome =
  | { result: "ok" }
  | { result: "not_found" }
  | { result: "attempts_block"; reason: AttemptBlock }
  | { result: "incomplete"; problems: PublishProblem[] }
  | { result: "invalid"; error: string }
  | { result: "too_many" }
  | { result: "mismatch" };

export async function insertExam(courseId: string, input: ExamFormInput): Promise<{ id: string }> {
  const [row] = await db.insert(exams).values({ courseId, ...input }).returning({ id: exams.id });
  return row;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class EditRejected extends Error {
  constructor(readonly outcome: EditOutcome) {
    super("edit rejected");
  }
}

/** Publish-gate problems for an exam's current (in-transaction) state. */
async function currentProblems(tx: Tx, examId: string): Promise<PublishProblem[]> {
  const [exam] = await tx
    .select({ titleEs: exams.titleEs, titleEn: exams.titleEn })
    .from(exams)
    .where(eq(exams.id, examId));
  const questions = await tx
    .select({
      type: examQuestions.type,
      promptEs: examQuestions.promptEs,
      promptEn: examQuestions.promptEn,
      optionsEs: examQuestions.optionsEs,
      optionsEn: examQuestions.optionsEn,
      correctOption: examQuestions.correctOption,
    })
    .from(examQuestions)
    .where(eq(examQuestions.examId, examId))
    .orderBy(asc(examQuestions.order), asc(examQuestions.createdAt));
  return examPublishProblems(exam, questions);
}

/**
 * Run an edit on an exam the actor owns, at any state (draft or published,
 * with or without attempts). The exam row is locked (ownership joined), the
 * edit runs, and if the exam is PUBLISHED the bilingual publish gate is
 * re-run on the post-edit state: a failing edit is rolled back and rejected
 * (the exam is never silently unpublished). `fn` reports whether attempts
 * exist via `ctx.attempts` so it can refuse position-changing edits.
 * Returning anything but "ok" from `fn` means it made no writes.
 */
async function editOwnedExam(
  examId: string,
  actor: Actor,
  fn: (tx: Tx, ctx: { attempts: number }) => Promise<EditOutcome>,
): Promise<EditOutcome> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: exams.id, publishedAt: exams.publishedAt })
        .from(exams)
        .innerJoin(courses, eq(exams.courseId, courses.id))
        .where(ownerCondition(examId, actor))
        .for("update", { of: exams })
        .limit(1);
      if (!row) return { result: "not_found" } as const;
      const [{ n }] = await tx.select({ n: count() }).from(examSubmissions).where(eq(examSubmissions.examId, examId));
      const outcome = await fn(tx, { attempts: n });
      if (outcome.result !== "ok") return outcome;
      if (row.publishedAt) {
        const problems = await currentProblems(tx, examId);
        if (problems.length > 0) throw new EditRejected({ result: "incomplete", problems });
      }
      return outcome;
    });
  } catch (e) {
    if (e instanceof EditRejected) return e.outcome;
    throw e;
  }
}

/** Exam fields are always editable; max_attempts / duration apply to future attempts. */
export async function updateExam(examId: string, actor: Actor, input: ExamFormInput): Promise<EditOutcome> {
  return editOwnedExam(examId, actor, async (tx) => {
    await tx.update(exams).set({ ...input, updatedAt: new Date() }).where(eq(exams.id, examId));
    return { result: "ok" };
  });
}

/** Delete an exam that has no attempts (a cascade would destroy student work). */
export async function deleteExam(examId: string, actor: Actor): Promise<WriteResult | "has_attempts"> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: exams.id })
      .from(exams)
      .innerJoin(courses, eq(exams.courseId, courses.id))
      .where(ownerCondition(examId, actor))
      .for("update", { of: exams })
      .limit(1);
    if (!row) return "not_found";
    const [{ n }] = await tx.select({ n: count() }).from(examSubmissions).where(eq(examSubmissions.examId, examId));
    if (n > 0) return "has_attempts";
    await tx.delete(exams).where(eq(exams.id, examId));
    return "ok";
  });
}

export type PublishResult =
  | { ok: true; courseId: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "incomplete"; problems: PublishProblem[] };

export async function publishExam(examId: string, actor: Actor): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    const [exam] = await tx
      .select({ id: exams.id, courseId: exams.courseId, publishedAt: exams.publishedAt })
      .from(exams)
      .innerJoin(courses, eq(exams.courseId, courses.id))
      .where(ownerCondition(examId, actor))
      .for("update", { of: exams })
      .limit(1);
    if (!exam) return { ok: false, reason: "not_found" } as const;
    if (exam.publishedAt) return { ok: true, courseId: exam.courseId } as const;

    const problems = await currentProblems(tx, examId);
    if (problems.length > 0) return { ok: false, reason: "incomplete", problems } as const;

    await tx.update(exams).set({ publishedAt: new Date(), updatedAt: new Date() }).where(eq(exams.id, examId));
    return { ok: true, courseId: exam.courseId } as const;
  });
}

/**
 * Unpublish at any time, including after attempts exist (nothing is deleted;
 * students just stop seeing the exam, their attempts and grades until it is
 * published again).
 */
export async function unpublishExam(examId: string, actor: Actor): Promise<WriteResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: exams.id })
      .from(exams)
      .innerJoin(courses, eq(exams.courseId, courses.id))
      .where(ownerCondition(examId, actor))
      .for("update", { of: exams })
      .limit(1);
    if (!row) return "not_found";
    await tx.update(exams).set({ publishedAt: null, updatedAt: new Date() }).where(eq(exams.id, examId));
    return "ok";
  });
}

export type QuestionWriteResult = EditOutcome;

export async function insertQuestion(
  examId: string,
  actor: Actor,
  type: QuestionType,
  fields: QuestionFieldsInput,
): Promise<EditOutcome> {
  const normalized = normalizeQuestionFields(type, fields);
  if (!normalized.ok) return { result: "invalid", error: normalized.error };
  return editOwnedExam(examId, actor, async (tx, { attempts }) => {
    // A new question would be missing from every existing attempt.
    if (attempts > 0) return { result: "attempts_block", reason: "add_question" };
    const [{ next, n }] = await tx
      .select({
        next: sql<number>`coalesce(max(${examQuestions.order}), -1) + 1`,
        n: count(),
      })
      .from(examQuestions)
      .where(eq(examQuestions.examId, examId));
    if (n >= MAX_QUESTIONS_PER_EXAM) return { result: "too_many" };
    await tx.insert(examQuestions).values({ examId, type, order: next, ...normalized.columns });
    return { result: "ok" };
  });
}

/**
 * Update a question's fields (type is immutable). Allowed at any state;
 * with attempts, option count/order may not change. Ownership is joined
 * through the exam.
 */
export async function updateQuestion(questionId: string, actor: Actor, fields: QuestionFieldsInput): Promise<EditOutcome> {
  const [q] = await db
    .select({ examId: examQuestions.examId })
    .from(examQuestions)
    .where(eq(examQuestions.id, questionId))
    .limit(1);
  if (!q) return { result: "not_found" };
  return editOwnedExam(q.examId, actor, async (tx, { attempts }) => {
    const [cur] = await tx
      .select({
        type: examQuestions.type,
        optionsEs: examQuestions.optionsEs,
        optionsEn: examQuestions.optionsEn,
        promptEs: examQuestions.promptEs,
        promptEn: examQuestions.promptEn,
      })
      .from(examQuestions)
      .where(and(eq(examQuestions.id, questionId), eq(examQuestions.examId, q.examId)));
    if (!cur) return { result: "not_found" };
    const normalized = normalizeQuestionFields(cur.type, fields);
    if (!normalized.ok) return { result: "invalid", error: normalized.error };
    if (attempts > 0 && cur.type === "multiple_choice") {
      const reason = optionEditBlock(cur, normalized.columns);
      if (reason) return { result: "attempts_block", reason };
    }
    if (attempts > 0 && cur.type === "fill_in_the_blank") {
      const reason = blankEditBlock(cur, normalized.columns);
      if (reason) return { result: "attempts_block", reason };
    }
    await tx
      .update(examQuestions)
      .set(normalized.columns)
      .where(and(eq(examQuestions.id, questionId), eq(examQuestions.examId, q.examId)));
    return { result: "ok" };
  });
}

export async function deleteQuestion(questionId: string, actor: Actor): Promise<EditOutcome> {
  const [q] = await db
    .select({ examId: examQuestions.examId })
    .from(examQuestions)
    .where(eq(examQuestions.id, questionId))
    .limit(1);
  if (!q) return { result: "not_found" };
  return editOwnedExam(q.examId, actor, async (tx, { attempts }) => {
    if (attempts > 0) return { result: "attempts_block", reason: "delete_question" };
    const deleted = await tx
      .delete(examQuestions)
      .where(and(eq(examQuestions.id, questionId), eq(examQuestions.examId, q.examId)))
      .returning({ id: examQuestions.id });
    return deleted.length ? { result: "ok" } : { result: "not_found" };
  });
}

/** Apply a full new order; the list must cover exactly the exam's questions. Blocked once attempts exist. */
export async function reorderQuestions(examId: string, actor: Actor, orderedIds: string[]): Promise<EditOutcome> {
  return editOwnedExam(examId, actor, async (tx, { attempts }) => {
    const existing = await tx.select({ id: examQuestions.id }).from(examQuestions).where(eq(examQuestions.examId, examId));
    const ids = new Set(existing.map((r) => r.id));
    if (ids.size !== orderedIds.length || !orderedIds.every((id) => ids.has(id))) return { result: "mismatch" };
    if (attempts > 0) return { result: "attempts_block", reason: "reorder_questions" };
    for (const [index, id] of orderedIds.entries()) {
      await tx.update(examQuestions).set({ order: index }).where(and(eq(examQuestions.id, id), eq(examQuestions.examId, examId)));
    }
    return { result: "ok" };
  });
}

/**
 * Record manual grading: points per answered manual question (fill in the
 * blank / essay), 0..that question's weight in half-point steps, plus overall
 * feedback and optional per-answer comments. Ownership joined; only a
 * SUBMITTED attempt can be graded. Every answered manual question needs
 * points (the form is the source of truth: missing comment = cleared).
 * Ids in the maps that aren't this submission's answers are ignored. The
 * legacy overall `grade` is cleared, so a re-graded old attempt moves to the
 * points model. Multiple choice / true-false are never graded here.
 */
export async function gradeSubmission(
  submissionId: string,
  actor: Actor,
  input: GradeInput,
): Promise<{ result: "ok" | "not_found" | "not_submitted" | "invalid"; error?: string; examId?: string; courseId?: string }> {
  return db.transaction(async (tx) => {
    const ownership =
      actor.role === "admin"
        ? eq(examSubmissions.id, submissionId)
        : and(eq(examSubmissions.id, submissionId), eq(courses.professorId, actor.id));
    const [row] = await tx
      .select({
        id: examSubmissions.id,
        examId: examSubmissions.examId,
        courseId: exams.courseId,
        submittedAt: examSubmissions.submittedAt,
      })
      .from(examSubmissions)
      .innerJoin(exams, eq(examSubmissions.examId, exams.id))
      .innerJoin(courses, eq(exams.courseId, courses.id))
      .where(ownership)
      .for("update", { of: examSubmissions })
      .limit(1);
    if (!row) return { result: "not_found" as const };
    if (!row.submittedAt) return { result: "not_submitted" as const };

    const answers = await tx
      .select({ id: examAnswers.id, questionId: examAnswers.questionId, type: examQuestions.type, weight: examQuestions.points })
      .from(examAnswers)
      .innerJoin(examQuestions, eq(examAnswers.questionId, examQuestions.id))
      .where(eq(examAnswers.submissionId, submissionId));

    const awards = new Map<string, number>();
    for (const a of answers) {
      if (a.type === "multiple_choice" || a.type === "true_false") continue;
      const pts = input.answerPoints[a.questionId];
      if (pts === undefined) return { result: "invalid" as const, error: "Award points for every question that needs grading." };
      if (pts > a.weight) return { result: "invalid" as const, error: `Points can't be more than the question's ${a.weight}.` };
      awards.set(a.id, pts);
    }

    await tx
      .update(examSubmissions)
      .set({ grade: null, feedback: input.feedback, gradedAt: new Date(), gradedBy: actor.id })
      .where(eq(examSubmissions.id, submissionId));
    for (const a of answers) {
      const comment = input.answerFeedback[a.questionId]?.trim();
      await tx
        .update(examAnswers)
        .set({ feedback: comment ? comment : null, pointsAwarded: awards.get(a.id) ?? null })
        .where(eq(examAnswers.id, a.id));
    }
    return { result: "ok" as const, examId: row.examId, courseId: row.courseId };
  });
}
