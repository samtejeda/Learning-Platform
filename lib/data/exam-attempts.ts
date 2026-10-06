import "server-only";

import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { enrollments, examAnswers, examQuestions, examSubmissions, exams } from "@/lib/db/schema";
import { asStringArray, type ContentLanguage } from "@/lib/exams/language";
import { validateAnswers, type RawAnswer } from "@/lib/exams/answers";
import { attemptDeadline, closeTimeFor, isPastDeadline, isPastGrace } from "@/lib/exams/timing";

// Student-side exam reads and the attempt lifecycle. NOTHING in this file
// selects examQuestions.correctOption or the reference_answer_* columns:
// answer keys never reach a student-facing response. Every function takes
// the student's id and joins enrollment (and published) into the query.
//
// Lifecycle: startAttempt (≤ maxAttempts, one open attempt at a time, language
// fixed for the attempt) → saveAttemptAnswers (autosave, replace-all) →
// submitAttempt. Past its deadline an attempt is closed lazily with the
// autosaved answers and submittedAt = the deadline; there is no cron.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const text = (lang: ContentLanguage, es: unknown, en: unknown) => (lang === "es" ? es : en);

/** Close this student's expired in-progress attempts (optionally for one exam). */
async function closeExpiredForStudent(studentId: string, examId?: string): Promise<void> {
  await db.execute(sql`
    update exam_submissions s
    set submitted_at = s.started_at + make_interval(mins => e.duration_minutes)
    from exams e
    where e.id = s.exam_id and s.student_id = ${studentId}::uuid and s.submitted_at is null
      and (${examId ?? null}::uuid is null or s.exam_id = ${examId ?? null}::uuid)
      and now() > s.started_at + make_interval(mins => e.duration_minutes)
  `);
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export type StudentExamListItem = {
  id: string;
  title: string | null;
  durationMinutes: number;
  maxAttempts: number;
  attemptsUsed: number;
  /** Highest graded attempt; null until something is graded. */
  gradeOfRecord: number | null;
  openAttemptId: string | null;
};

/** Published exams in a course the student is enrolled in. */
export async function listExamsForStudent(
  courseId: string,
  studentId: string,
  language: ContentLanguage,
): Promise<StudentExamListItem[]> {
  await closeExpiredForStudent(studentId);
  const titleCol = language === "es" ? exams.titleEs : exams.titleEn;
  return db
    .select({
      id: exams.id,
      title: titleCol,
      durationMinutes: exams.durationMinutes,
      maxAttempts: exams.maxAttempts,
      attemptsUsed: sql<number>`(select count(*)::int from ${examSubmissions} s where s.exam_id = ${exams.id} and s.student_id = ${studentId})`,
      gradeOfRecord: sql<number | null>`(select max(s.grade) from ${examSubmissions} s where s.exam_id = ${exams.id} and s.student_id = ${studentId} and s.graded_at is not null)`,
      openAttemptId: sql<string | null>`(select s.id from ${examSubmissions} s where s.exam_id = ${exams.id} and s.student_id = ${studentId} and s.submitted_at is null limit 1)`,
    })
    .from(exams)
    .innerJoin(enrollments, and(eq(enrollments.courseId, exams.courseId), eq(enrollments.studentId, studentId)))
    .where(and(eq(exams.courseId, courseId), isNotNull(exams.publishedAt)))
    .orderBy(asc(exams.createdAt));
}

export type StudentExamLanding = StudentExamListItem & {
  courseId: string;
  description: string | null;
  questionCount: number;
  attempts: { id: string; attemptNumber: number; submittedAt: Date | null; grade: number | null }[];
};

export async function getExamLandingForStudent(
  examId: string,
  studentId: string,
  language: ContentLanguage,
): Promise<StudentExamLanding | null> {
  await closeExpiredForStudent(studentId, examId);
  const [row] = await db
    .select({
      id: exams.id,
      courseId: exams.courseId,
      title: language === "es" ? exams.titleEs : exams.titleEn,
      description: language === "es" ? exams.descriptionEs : exams.descriptionEn,
      durationMinutes: exams.durationMinutes,
      maxAttempts: exams.maxAttempts,
      questionCount: sql<number>`(select count(*)::int from ${examQuestions} q where q.exam_id = ${exams.id})`,
    })
    .from(exams)
    .innerJoin(enrollments, and(eq(enrollments.courseId, exams.courseId), eq(enrollments.studentId, studentId)))
    .where(and(eq(exams.id, examId), isNotNull(exams.publishedAt)))
    .limit(1);
  if (!row) return null;
  const attempts = await db
    .select({
      id: examSubmissions.id,
      attemptNumber: examSubmissions.attemptNumber,
      submittedAt: examSubmissions.submittedAt,
      // The grade is invisible to the student until the professor has graded.
      grade: sql<number | null>`case when ${examSubmissions.gradedAt} is not null then ${examSubmissions.grade} end`,
    })
    .from(examSubmissions)
    .where(and(eq(examSubmissions.examId, examId), eq(examSubmissions.studentId, studentId)))
    .orderBy(asc(examSubmissions.attemptNumber));
  const grades = attempts.map((a) => a.grade).filter((g): g is number => g !== null);
  return {
    ...row,
    attemptsUsed: attempts.length,
    gradeOfRecord: grades.length ? Math.max(...grades) : null,
    openAttemptId: attempts.find((a) => a.submittedAt === null)?.id ?? null,
    attempts,
  };
}

export type StudentAttemptQuestion = {
  id: string;
  type: "multiple_choice" | "true_false" | "fill_in_the_blank" | "short_essay";
  order: number;
  prompt: string | null;
  /** Multiple choice only; text in the attempt's language. */
  options: string[] | null;
};

export type StudentAttempt = {
  id: string;
  examId: string;
  courseId: string;
  attemptNumber: number;
  language: ContentLanguage;
  startedAt: Date;
  deadline: Date;
  submittedAt: Date | null;
  status: "in_progress" | "submitted";
  title: string | null;
  description: string | null;
  questions: StudentAttemptQuestion[];
  answers: {
    questionId: string;
    selectedOption: number | null;
    answerText: string | null;
    /** Only once graded. */
    feedback: string | null;
  }[];
  /** Only once graded; null before. */
  grade: number | null;
  feedback: string | null;
};

/** The student's own attempt (any state), or null if not theirs / not enrolled. */
export async function getAttemptForStudent(attemptId: string, studentId: string): Promise<StudentAttempt | null> {
  const find = () =>
    db
      .select({
        id: examSubmissions.id,
        examId: examSubmissions.examId,
        courseId: exams.courseId,
        attemptNumber: examSubmissions.attemptNumber,
        language: examSubmissions.language,
        startedAt: examSubmissions.startedAt,
        submittedAt: examSubmissions.submittedAt,
        durationMinutes: exams.durationMinutes,
        titleEs: exams.titleEs,
        titleEn: exams.titleEn,
        descriptionEs: exams.descriptionEs,
        descriptionEn: exams.descriptionEn,
        grade: examSubmissions.grade,
        feedback: examSubmissions.feedback,
        gradedAt: examSubmissions.gradedAt,
      })
      .from(examSubmissions)
      .innerJoin(exams, eq(examSubmissions.examId, exams.id))
      .innerJoin(enrollments, and(eq(enrollments.courseId, exams.courseId), eq(enrollments.studentId, studentId)))
      .where(and(eq(examSubmissions.id, attemptId), eq(examSubmissions.studentId, studentId)))
      .limit(1);

  let [row] = await find();
  if (!row) return null;
  if (!row.submittedAt && isPastDeadline(new Date(), row.startedAt, row.durationMinutes)) {
    await closeExpiredForStudent(studentId, row.examId);
    [row] = await find();
    if (!row) return null;
  }
  const lang = row.language;
  const graded = row.gradedAt !== null;

  const qs = await db
    .select({
      id: examQuestions.id,
      type: examQuestions.type,
      order: examQuestions.order,
      promptEs: examQuestions.promptEs,
      promptEn: examQuestions.promptEn,
      optionsEs: examQuestions.optionsEs,
      optionsEn: examQuestions.optionsEn,
    })
    .from(examQuestions)
    .where(eq(examQuestions.examId, row.examId))
    .orderBy(asc(examQuestions.order), asc(examQuestions.createdAt));
  const ans = await db
    .select({
      questionId: examAnswers.questionId,
      selectedOption: examAnswers.selectedOption,
      answerText: examAnswers.answerText,
      feedback: examAnswers.feedback,
    })
    .from(examAnswers)
    .where(eq(examAnswers.submissionId, attemptId));

  return {
    id: row.id,
    examId: row.examId,
    courseId: row.courseId,
    attemptNumber: row.attemptNumber,
    language: lang,
    startedAt: row.startedAt,
    deadline: attemptDeadline(row.startedAt, row.durationMinutes),
    submittedAt: row.submittedAt,
    status: row.submittedAt ? "submitted" : "in_progress",
    title: text(lang, row.titleEs, row.titleEn) as string | null,
    description: text(lang, row.descriptionEs, row.descriptionEn) as string | null,
    questions: qs.map((q) => ({
      id: q.id,
      type: q.type,
      order: q.order,
      prompt: text(lang, q.promptEs, q.promptEn) as string | null,
      options: q.type === "multiple_choice" ? asStringArray(text(lang, q.optionsEs, q.optionsEn)) : null,
    })),
    answers: ans.map((a) => ({ ...a, feedback: graded ? a.feedback : null })),
    grade: graded ? row.grade : null,
    feedback: graded ? row.feedback : null,
  };
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export type StartResult =
  | { ok: true; attemptId: string; resumed: boolean }
  | { ok: false; reason: "not_found" | "no_attempts_left" };

/**
 * Begin (or resume) an attempt. Serialised per student+exam with an advisory
 * lock so two taps can't create two attempts. The exam row is read FOR SHARE,
 * so a concurrent unpublish (which takes FOR UPDATE) can't slip between the
 * published check and the insert.
 */
export async function startAttempt(examId: string, studentId: string, language: ContentLanguage): Promise<StartResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${studentId + ":" + examId}, 0))`);
    const [exam] = await tx
      .select({ id: exams.id, maxAttempts: exams.maxAttempts })
      .from(exams)
      .innerJoin(enrollments, and(eq(enrollments.courseId, exams.courseId), eq(enrollments.studentId, studentId)))
      .where(and(eq(exams.id, examId), isNotNull(exams.publishedAt)))
      .for("share", { of: exams })
      .limit(1);
    if (!exam) return { ok: false, reason: "not_found" } as const;

    await tx.execute(sql`
      update exam_submissions s
      set submitted_at = s.started_at + make_interval(mins => e.duration_minutes)
      from exams e
      where e.id = s.exam_id and s.exam_id = ${examId}::uuid and s.student_id = ${studentId}::uuid
        and s.submitted_at is null and now() > s.started_at + make_interval(mins => e.duration_minutes)
    `);

    const existing = await tx
      .select({ id: examSubmissions.id, submittedAt: examSubmissions.submittedAt })
      .from(examSubmissions)
      .where(and(eq(examSubmissions.examId, examId), eq(examSubmissions.studentId, studentId)));
    const open = existing.find((a) => a.submittedAt === null);
    if (open) return { ok: true, attemptId: open.id, resumed: true } as const;
    if (existing.length >= exam.maxAttempts) return { ok: false, reason: "no_attempts_left" } as const;

    const [row] = await tx
      .insert(examSubmissions)
      .values({ examId, studentId, attemptNumber: existing.length + 1, language })
      .returning({ id: examSubmissions.id });
    return { ok: true, attemptId: row.id, resumed: false } as const;
  });
}

type OpenAttempt = {
  id: string;
  examId: string;
  language: ContentLanguage;
  startedAt: Date;
  submittedAt: Date | null;
  durationMinutes: number;
};

/** Lock the student's own attempt (enrolled + published re-checked). */
async function lockOwnAttempt(tx: Tx, attemptId: string, studentId: string): Promise<OpenAttempt | null> {
  const [row] = await tx
    .select({
      id: examSubmissions.id,
      examId: examSubmissions.examId,
      language: examSubmissions.language,
      startedAt: examSubmissions.startedAt,
      submittedAt: examSubmissions.submittedAt,
      durationMinutes: exams.durationMinutes,
    })
    .from(examSubmissions)
    .innerJoin(exams, eq(examSubmissions.examId, exams.id))
    .innerJoin(enrollments, and(eq(enrollments.courseId, exams.courseId), eq(enrollments.studentId, studentId)))
    .where(and(eq(examSubmissions.id, attemptId), eq(examSubmissions.studentId, studentId), isNotNull(exams.publishedAt)))
    .for("update", { of: examSubmissions })
    .limit(1);
  return row ?? null;
}

async function loadQuestionsTx(tx: Tx, examId: string) {
  return tx
    .select({
      id: examQuestions.id,
      type: examQuestions.type,
      optionsEs: examQuestions.optionsEs,
      optionsEn: examQuestions.optionsEn,
    })
    .from(examQuestions)
    .where(eq(examQuestions.examId, examId));
}

async function replaceAnswers(
  tx: Tx,
  attemptId: string,
  answers: { questionId: string; selectedOption: number | null; answerText: string | null }[],
) {
  await tx.delete(examAnswers).where(eq(examAnswers.submissionId, attemptId));
  if (answers.length > 0) {
    await tx.insert(examAnswers).values(answers.map((a) => ({ submissionId: attemptId, ...a })));
  }
}

async function closeTx(tx: Tx, a: OpenAttempt, now: Date) {
  await tx
    .update(examSubmissions)
    .set({ submittedAt: closeTimeFor(now, a.startedAt, a.durationMinutes) })
    .where(eq(examSubmissions.id, a.id));
}

export type AttemptWriteResult =
  | { ok: true; unanswered: number; deadline: Date }
  | { ok: false; reason: "not_found" | "already_submitted" | "expired" | "invalid"; error?: string };

/** Autosave: replace the attempt's saved answers with the posted set (partial is fine). */
export async function saveAttemptAnswers(
  attemptId: string,
  studentId: string,
  raw: RawAnswer[],
): Promise<AttemptWriteResult> {
  return db.transaction(async (tx) => {
    const a = await lockOwnAttempt(tx, attemptId, studentId);
    if (!a) return { ok: false, reason: "not_found" } as const;
    if (a.submittedAt) return { ok: false, reason: "already_submitted" } as const;
    const now = new Date();
    if (isPastDeadline(now, a.startedAt, a.durationMinutes)) {
      await closeTx(tx, a, now);
      return { ok: false, reason: "expired" } as const;
    }
    const questions = await loadQuestionsTx(tx, a.examId);
    const v = validateAnswers(questions, raw, a.language, false);
    if (!v.ok) return { ok: false, reason: "invalid", error: v.error } as const;
    await replaceAnswers(tx, attemptId, v.answers);
    return { ok: true, unanswered: v.unansweredQuestionIds.length, deadline: attemptDeadline(a.startedAt, a.durationMinutes) } as const;
  });
}

/**
 * Final submit. Within the deadline (+ a small grace for network lag) the
 * posted answers must cover every question. Past the grace the attempt is
 * closed at its deadline with whatever was autosaved, and the caller is told
 * it expired.
 */
export async function submitAttempt(
  attemptId: string,
  studentId: string,
  raw: RawAnswer[],
): Promise<AttemptWriteResult> {
  return db.transaction(async (tx) => {
    const a = await lockOwnAttempt(tx, attemptId, studentId);
    if (!a) return { ok: false, reason: "not_found" } as const;
    if (a.submittedAt) return { ok: false, reason: "already_submitted" } as const;
    const now = new Date();
    if (isPastGrace(now, a.startedAt, a.durationMinutes)) {
      await closeTx(tx, a, now);
      return { ok: false, reason: "expired" } as const;
    }
    const questions = await loadQuestionsTx(tx, a.examId);
    const v = validateAnswers(questions, raw, a.language, true);
    if (!v.ok) return { ok: false, reason: "invalid", error: v.error } as const;
    await replaceAnswers(tx, attemptId, v.answers);
    await closeTx(tx, a, now);
    return { ok: true, unanswered: 0, deadline: attemptDeadline(a.startedAt, a.durationMinutes) } as const;
  });
}
