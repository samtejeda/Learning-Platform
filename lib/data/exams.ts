import "server-only";

import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { courses, examAnswers, examQuestions, examSubmissions, exams, users } from "@/lib/db/schema";
import type { Actor } from "./courses";
import { examPublishProblems, type PublishProblem } from "@/lib/exams/publish-rules";
import { normalizeQuestionFields, type QuestionType } from "@/lib/exams/question";
import { asStringArray, type ContentLanguage } from "@/lib/exams/language";
import { MAX_QUESTIONS_PER_EXAM } from "@/lib/exams/limits";
import type { ExamFormInput, GradeInput, QuestionFieldsInput } from "@/lib/validation/exams";

// Professor-side exam reads and writes (authoring, publish gate, grading).
// Every function takes the acting user and joins course ownership into the
// query (professor = own course, admin = any). Student-side reads and the
// attempt lifecycle live in lib/data/exam-attempts.ts. Answer keys and
// reference answers appear ONLY in this file's professor DTOs.
//
// Lifecycle rules enforced here (not in the UI):
//  - Exam fields and questions are editable only while the exam is a DRAFT.
//  - An exam can be unpublished or deleted only while it has NO attempts
//    (any exam_submissions row, in progress or submitted): structure is
//    frozen after the first attempt so a graded answer never changes meaning.
//  - Publish re-runs the bilingual completeness gate inside the transaction
//    that locks the exam row.

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
  grade: number | null;
  gradedAt: Date | null;
  /** Highest graded attempt for this student on this exam (grade of record). */
  gradeOfRecord: number | null;
};

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
  return db
    .select({
      id: examSubmissions.id,
      studentName: users.fullName,
      studentEmail: users.email,
      attemptNumber: examSubmissions.attemptNumber,
      language: examSubmissions.language,
      startedAt: examSubmissions.startedAt,
      submittedAt: examSubmissions.submittedAt,
      grade: examSubmissions.grade,
      gradedAt: examSubmissions.gradedAt,
      gradeOfRecord: sql<number | null>`(
        select max(g.grade) from ${examSubmissions} g
        where g.exam_id = ${examSubmissions.examId} and g.student_id = ${examSubmissions.studentId}
          and g.graded_at is not null
      )`,
    })
    .from(examSubmissions)
    .innerJoin(users, eq(examSubmissions.studentId, users.id))
    .where(eq(examSubmissions.examId, examId))
    .orderBy(asc(users.fullName), asc(users.email), asc(examSubmissions.attemptNumber));
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
  grade: number | null;
  feedback: string | null;
  gradedAt: Date | null;
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
      grade: examSubmissions.grade,
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
      selectedOption: examAnswers.selectedOption,
      answerText: examAnswers.answerText,
      feedback: examAnswers.feedback,
    })
    .from(examQuestions)
    .leftJoin(
      examAnswers,
      and(eq(examAnswers.questionId, examQuestions.id), eq(examAnswers.submissionId, submissionId)),
    )
    .where(eq(examQuestions.examId, row.examId))
    .orderBy(asc(examQuestions.order), asc(examQuestions.createdAt));

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
    grade: row.grade,
    feedback: row.feedback,
    gradedAt: row.gradedAt,
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
      feedback: q.feedback,
    })),
  };
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export type WriteResult = "ok" | "not_found" | "locked";

export async function insertExam(courseId: string, input: ExamFormInput): Promise<{ id: string }> {
  const [row] = await db.insert(exams).values({ courseId, ...input }).returning({ id: exams.id });
  return row;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Lock the exam row (ownership joined) and report whether structure may
 * change: draft only. Draft implies no attempts, because an exam can't be
 * unpublished once an attempt exists and attempts can't start on a draft.
 */
async function lockOwnedDraft(tx: Tx, examId: string, actor: Actor) {
  const [row] = await tx
    .select({ id: exams.id, courseId: exams.courseId, publishedAt: exams.publishedAt })
    .from(exams)
    .innerJoin(courses, eq(exams.courseId, courses.id))
    .where(ownerCondition(examId, actor))
    .for("update", { of: exams })
    .limit(1);
  if (!row) return { state: "not_found" as const };
  if (row.publishedAt) return { state: "locked" as const, courseId: row.courseId };
  return { state: "draft" as const, courseId: row.courseId };
}

export async function updateExam(examId: string, actor: Actor, input: ExamFormInput): Promise<WriteResult> {
  return db.transaction(async (tx) => {
    const lock = await lockOwnedDraft(tx, examId, actor);
    if (lock.state !== "draft") return lock.state;
    await tx.update(exams).set({ ...input, updatedAt: new Date() }).where(eq(exams.id, examId));
    return "ok";
  });
}

/** Delete an exam that has no attempts (a published exam with no attempts may go). */
export async function deleteExam(examId: string, actor: Actor): Promise<WriteResult> {
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
    if (n > 0) return "locked";
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
      .select({
        id: exams.id,
        courseId: exams.courseId,
        titleEs: exams.titleEs,
        titleEn: exams.titleEn,
        publishedAt: exams.publishedAt,
      })
      .from(exams)
      .innerJoin(courses, eq(exams.courseId, courses.id))
      .where(ownerCondition(examId, actor))
      .for("update", { of: exams })
      .limit(1);
    if (!exam) return { ok: false, reason: "not_found" } as const;
    if (exam.publishedAt) return { ok: true, courseId: exam.courseId } as const;

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
    const problems = examPublishProblems(exam, questions);
    if (problems.length > 0) return { ok: false, reason: "incomplete", problems } as const;

    await tx.update(exams).set({ publishedAt: new Date(), updatedAt: new Date() }).where(eq(exams.id, examId));
    return { ok: true, courseId: exam.courseId } as const;
  });
}

/** Unpublish only while no attempt exists. */
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
    const [{ n }] = await tx.select({ n: count() }).from(examSubmissions).where(eq(examSubmissions.examId, examId));
    if (n > 0) return "locked";
    await tx.update(exams).set({ publishedAt: null, updatedAt: new Date() }).where(eq(exams.id, examId));
    return "ok";
  });
}

export type QuestionWriteResult = WriteResult | "invalid" | "too_many";

export async function insertQuestion(
  examId: string,
  actor: Actor,
  type: QuestionType,
  fields: QuestionFieldsInput,
): Promise<{ result: QuestionWriteResult; error?: string }> {
  const normalized = normalizeQuestionFields(type, fields);
  if (!normalized.ok) return { result: "invalid", error: normalized.error };
  return db.transaction(async (tx) => {
    const lock = await lockOwnedDraft(tx, examId, actor);
    if (lock.state !== "draft") return { result: lock.state };
    const [{ next, n }] = await tx
      .select({
        next: sql<number>`coalesce(max(${examQuestions.order}), -1) + 1`,
        n: count(),
      })
      .from(examQuestions)
      .where(eq(examQuestions.examId, examId));
    if (n >= MAX_QUESTIONS_PER_EXAM) return { result: "too_many" as const };
    await tx.insert(examQuestions).values({ examId, type, order: next, ...normalized.columns });
    return { result: "ok" as const };
  });
}

/** Update a question's fields (type is immutable). Draft only; ownership joined through the exam. */
export async function updateQuestion(
  questionId: string,
  actor: Actor,
  fields: QuestionFieldsInput,
): Promise<{ result: QuestionWriteResult; error?: string }> {
  return db.transaction(async (tx) => {
    const [q] = await tx
      .select({ examId: examQuestions.examId, type: examQuestions.type })
      .from(examQuestions)
      .where(eq(examQuestions.id, questionId))
      .limit(1);
    if (!q) return { result: "not_found" as const };
    const lock = await lockOwnedDraft(tx, q.examId, actor);
    if (lock.state !== "draft") return { result: lock.state };
    const normalized = normalizeQuestionFields(q.type, fields);
    if (!normalized.ok) return { result: "invalid" as const, error: normalized.error };
    await tx
      .update(examQuestions)
      .set(normalized.columns)
      .where(and(eq(examQuestions.id, questionId), eq(examQuestions.examId, q.examId)));
    return { result: "ok" as const };
  });
}

export async function deleteQuestion(questionId: string, actor: Actor): Promise<WriteResult> {
  return db.transaction(async (tx) => {
    const [q] = await tx
      .select({ examId: examQuestions.examId })
      .from(examQuestions)
      .where(eq(examQuestions.id, questionId))
      .limit(1);
    if (!q) return "not_found";
    const lock = await lockOwnedDraft(tx, q.examId, actor);
    if (lock.state !== "draft") return lock.state;
    await tx.delete(examQuestions).where(and(eq(examQuestions.id, questionId), eq(examQuestions.examId, q.examId)));
    return "ok";
  });
}

/** Apply a full new order; the list must cover exactly the exam's questions. Draft only. */
export async function reorderQuestions(
  examId: string,
  actor: Actor,
  orderedIds: string[],
): Promise<WriteResult | "mismatch"> {
  return db.transaction(async (tx) => {
    const lock = await lockOwnedDraft(tx, examId, actor);
    if (lock.state !== "draft") return lock.state;
    const existing = await tx.select({ id: examQuestions.id }).from(examQuestions).where(eq(examQuestions.examId, examId));
    const ids = new Set(existing.map((r) => r.id));
    if (ids.size !== orderedIds.length || !orderedIds.every((id) => ids.has(id))) return "mismatch";
    for (const [index, id] of orderedIds.entries()) {
      await tx.update(examQuestions).set({ order: index }).where(and(eq(examQuestions.id, id), eq(examQuestions.examId, examId)));
    }
    return "ok";
  });
}

/**
 * Record a manual grade. Ownership joined; only a SUBMITTED attempt can be
 * graded. Per-answer comments apply only to answers that belong to this
 * submission (other ids in the map are ignored); answers missing from the
 * map have their comment cleared, so the form is the source of truth.
 */
export async function gradeSubmission(
  submissionId: string,
  actor: Actor,
  input: GradeInput,
): Promise<{ result: "ok" | "not_found" | "not_submitted"; examId?: string; courseId?: string }> {
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

    await tx
      .update(examSubmissions)
      .set({ grade: input.grade, feedback: input.feedback, gradedAt: new Date(), gradedBy: actor.id })
      .where(eq(examSubmissions.id, submissionId));

    const answers = await tx
      .select({ id: examAnswers.id, questionId: examAnswers.questionId })
      .from(examAnswers)
      .where(eq(examAnswers.submissionId, submissionId));
    for (const a of answers) {
      const comment = input.answerFeedback[a.questionId]?.trim();
      await tx
        .update(examAnswers)
        .set({ feedback: comment ? comment : null })
        .where(eq(examAnswers.id, a.id));
    }
    return { result: "ok" as const, examId: row.examId, courseId: row.courseId };
  });
}
