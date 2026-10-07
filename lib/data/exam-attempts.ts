import "server-only";

import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { enrollments, examAnswers, examQuestions, examSubmissions, exams } from "@/lib/db/schema";
import { revealedKeysForStudent, scoreSubmissions } from "@/lib/data/exam-results";
import { countBlanks } from "@/lib/exams/blanks";
import { gradeOfRecord, type QuestionScore } from "@/lib/exams/scoring";
import { asStringArray, type ContentLanguage } from "@/lib/exams/language";
import { validateAnswers, type RawAnswer } from "@/lib/exams/answers";
import { attemptDeadline, closeTimeFor, isPastDeadline, isPastGrace } from "@/lib/exams/timing";

// Student-side exam reads and the attempt lifecycle. NOTHING in this file
// selects examQuestions.correctOption or the reference_answer_* columns.
// Scores come from lib/data/exam-results.ts (derived, no keys returned);
// the key itself reaches a student only through its reveal rule
// (`revealedAnswers`, off by default). Correctness flags and scores are only
// ever computed for SUBMITTED attempts: nothing leaks mid-attempt. Every function takes
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
  /** Highest FINAL attempt percent (0–100); null until one is final. */
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
  const rows = await db
    .select({
      id: exams.id,
      title: titleCol,
      durationMinutes: exams.durationMinutes,
      maxAttempts: exams.maxAttempts,
      attemptsUsed: sql<number>`(select count(*)::int from ${examSubmissions} s where s.exam_id = ${exams.id} and s.student_id = ${studentId})`,
      openAttemptId: sql<string | null>`(select s.id from ${examSubmissions} s where s.exam_id = ${exams.id} and s.student_id = ${studentId} and s.submitted_at is null limit 1)`,
    })
    .from(exams)
    .innerJoin(enrollments, and(eq(enrollments.courseId, exams.courseId), eq(enrollments.studentId, studentId)))
    .where(and(eq(exams.courseId, courseId), isNotNull(exams.publishedAt)))
    .orderBy(asc(exams.createdAt));
  const refs = rows.length
    ? await db
        .select({ id: examSubmissions.id, examId: examSubmissions.examId, gradedAt: examSubmissions.gradedAt, grade: examSubmissions.grade })
        .from(examSubmissions)
        .where(and(inArray(examSubmissions.examId, rows.map((r) => r.id)), eq(examSubmissions.studentId, studentId), isNotNull(examSubmissions.submittedAt)))
    : [];
  const scores = await scoreSubmissions(refs);
  return rows.map((r) => ({
    ...r,
    gradeOfRecord: gradeOfRecord(refs.filter((x) => x.examId === r.id).map((x) => scores.get(x.id)!)),
  }));
}

export type StudentScoreSummary = {
  status: "pending" | "final";
  legacy: boolean;
  totalPoints: number;
  totalMax: number;
  /** Final percent; null while manual grading is pending. */
  percent: number | null;
  provisionalPercent: number | null;
};

export type StudentExamLanding = StudentExamListItem & {
  courseId: string;
  description: string | null;
  questionCount: number;
  attempts: {
    id: string;
    attemptNumber: number;
    submittedAt: Date | null;
    /** Final percent (0–100); null while in progress or pending manual grading. */
    grade: number | null;
    /** Null while in progress. */
    score: StudentScoreSummary | null;
  }[];
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
  const raw = await db
    .select({
      id: examSubmissions.id,
      examId: examSubmissions.examId,
      attemptNumber: examSubmissions.attemptNumber,
      submittedAt: examSubmissions.submittedAt,
      gradedAt: examSubmissions.gradedAt,
      legacyGrade: examSubmissions.grade,
    })
    .from(examSubmissions)
    .where(and(eq(examSubmissions.examId, examId), eq(examSubmissions.studentId, studentId)))
    .orderBy(asc(examSubmissions.attemptNumber));
  const scores = await scoreSubmissions(
    raw.filter((a) => a.submittedAt).map((a) => ({ id: a.id, examId: a.examId, gradedAt: a.gradedAt, grade: a.legacyGrade })),
  );
  const attempts = raw.map((a) => {
    const sc = a.submittedAt ? scores.get(a.id)! : null;
    return {
      id: a.id,
      attemptNumber: a.attemptNumber,
      submittedAt: a.submittedAt,
      grade: sc?.percent ?? null,
      score: sc
        ? { status: sc.status, legacy: sc.legacy, totalPoints: sc.totalPoints, totalMax: sc.totalMax, percent: sc.percent, provisionalPercent: sc.provisionalPercent }
        : null,
    };
  });
  return {
    ...row,
    attemptsUsed: attempts.length,
    gradeOfRecord: gradeOfRecord([...scores.values()]),
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
  /** Weight in points. */
  points: number;
  /** Fill in the blank: number of blanks in the prompt (the prompt carries the blank token); 0 = legacy single box. */
  blankCount: number;
};

export type StudentAttemptResult = {
  status: "pending" | "final";
  /** Attempt graded under the old one-grade model: only `percent` is meaningful. */
  legacy: boolean;
  autoPoints: number;
  autoMax: number;
  /** Awarded so far on manual questions. */
  manualPoints: number;
  manualMax: number;
  pendingManualMax: number;
  totalPoints: number;
  totalMax: number;
  /** Final percent (0–100); null while pending. */
  percent: number | null;
  provisionalPercent: number | null;
  /** Manual questions still awaiting the professor, by question id and 1-based number. */
  pending: { questionId: string; number: number }[];
  /** Per-question outcome: correct/incorrect/unanswered (auto) or awaiting/graded (manual). Never includes the key. */
  perQuestion: QuestionScore[];
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
    /** Fill in the blank with blanks: one entry per blank. */
    blankAnswers: string[] | null;
    /** Only once graded. */
    feedback: string | null;
  }[];
  /** Null while in progress; set once submitted (provisional until final). */
  result: StudentAttemptResult | null;
  /**
   * Correct positions of auto-scored questions. NULL unless the exam's
   * reveal setting is on AND every attempt is used up AND this attempt is
   * submitted. Never present mid-attempt.
   */
  revealedAnswers: { questionId: string; correct: number }[] | null;
  /** Final percent only; null while in progress or pending. */
  grade: number | null;
  /** Overall professor feedback, only once graded. */
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
        legacyGrade: examSubmissions.grade,
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
      points: examQuestions.points,
    })
    .from(examQuestions)
    .where(eq(examQuestions.examId, row.examId))
    .orderBy(asc(examQuestions.order), asc(examQuestions.createdAt));
  const ans = await db
    .select({
      questionId: examAnswers.questionId,
      selectedOption: examAnswers.selectedOption,
      answerText: examAnswers.answerText,
      blankAnswers: examAnswers.blankAnswers,
      feedback: examAnswers.feedback,
    })
    .from(examAnswers)
    .where(eq(examAnswers.submissionId, attemptId));

  let result: StudentAttemptResult | null = null;
  let revealedAnswers: StudentAttempt["revealedAnswers"] = null;
  if (row.submittedAt) {
    const sc = (await scoreSubmissions([{ id: row.id, examId: row.examId, gradedAt: row.gradedAt, grade: row.legacyGrade }])).get(row.id)!;
    const number = new Map(qs.map((q, i) => [q.id, i + 1]));
    result = {
      status: sc.status,
      legacy: sc.legacy,
      autoPoints: sc.autoPoints,
      autoMax: sc.autoMax,
      manualPoints: sc.manualPoints,
      manualMax: sc.manualMax,
      pendingManualMax: sc.pendingManualMax,
      totalPoints: sc.totalPoints,
      totalMax: sc.totalMax,
      percent: sc.percent,
      provisionalPercent: sc.provisionalPercent,
      pending: sc.pendingQuestionIds.map((id) => ({ questionId: id, number: number.get(id)! })),
      perQuestion: sc.perQuestion,
    };
    revealedAnswers = await revealedKeysForStudent(row.examId, studentId);
  }

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
      points: q.points,
      blankCount: q.type === "fill_in_the_blank" ? countBlanks(text(lang, q.promptEs, q.promptEn) as string | null) : 0,
    })),
    answers: ans.map((a) => ({ ...a, blankAnswers: asStringArray(a.blankAnswers).length ? asStringArray(a.blankAnswers) : null, feedback: graded ? a.feedback : null })),
    result,
    revealedAnswers,
    grade: result?.percent ?? null,
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
      promptEs: examQuestions.promptEs,
      promptEn: examQuestions.promptEn,
    })
    .from(examQuestions)
    .where(eq(examQuestions.examId, examId));
}

async function replaceAnswers(
  tx: Tx,
  attemptId: string,
  answers: { questionId: string; selectedOption: number | null; answerText: string | null; blankAnswers: string[] | null }[],
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
