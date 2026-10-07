import "server-only";

import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { examAnswers, examQuestions, examSubmissions, exams } from "@/lib/db/schema";
import { scoreAttempt, type AttemptScore, type ScoreQuestion } from "@/lib/exams/scoring";

// Server-internal scoring for BOTH sides. This is the only place outside
// lib/data/exams.ts that reads the answer key, and it never returns a key:
// callers get derived scores. The one exception is `revealedKeys`, which
// returns keys only when the exam's reveal rule is satisfied for that
// student. Scores are derived on every read (never stored), so correcting a
// key re-scores every attempt.

export type SubmissionRef = { id: string; examId: string; gradedAt: Date | null; grade: number | null };

/** Derived score for each given SUBMITTED attempt (callers never pass in-progress ones to students). */
export async function scoreSubmissions(refs: SubmissionRef[]): Promise<Map<string, AttemptScore>> {
  const result = new Map<string, AttemptScore>();
  if (refs.length === 0) return result;
  const examIds = [...new Set(refs.map((r) => r.examId))];

  const qs = await db
    .select({
      id: examQuestions.id,
      examId: examQuestions.examId,
      type: examQuestions.type,
      points: examQuestions.points,
      correctOption: examQuestions.correctOption,
    })
    .from(examQuestions)
    .where(inArray(examQuestions.examId, examIds))
    .orderBy(asc(examQuestions.order), asc(examQuestions.createdAt));
  const byExam = new Map<string, ScoreQuestion[]>();
  for (const q of qs) {
    const list = byExam.get(q.examId) ?? [];
    list.push({ id: q.id, type: q.type, points: q.points, correctOption: q.correctOption });
    byExam.set(q.examId, list);
  }

  const ans = await db
    .select({
      submissionId: examAnswers.submissionId,
      questionId: examAnswers.questionId,
      selectedOption: examAnswers.selectedOption,
      pointsAwarded: examAnswers.pointsAwarded,
    })
    .from(examAnswers)
    .where(inArray(examAnswers.submissionId, refs.map((r) => r.id)));
  const bySub = new Map<string, typeof ans>();
  for (const a of ans) {
    const list = bySub.get(a.submissionId) ?? [];
    list.push(a);
    bySub.set(a.submissionId, list);
  }

  for (const r of refs) {
    result.set(
      r.id,
      scoreAttempt({
        questions: byExam.get(r.examId) ?? [],
        answers: bySub.get(r.id) ?? [],
        legacyGrade: r.grade,
        gradedAt: r.gradedAt,
      }),
    );
  }
  return result;
}

/**
 * The correct positions of an exam's auto-scored questions, ONLY if the
 * exam's reveal setting is on and the student has used every attempt (and has
 * none open). Otherwise null. Never returns reference answers.
 */
export async function revealedKeysForStudent(
  examId: string,
  studentId: string,
): Promise<{ questionId: string; correct: number }[] | null> {
  const [exam] = await db
    .select({
      reveal: exams.revealKeysAfterAttempts,
      maxAttempts: exams.maxAttempts,
      used: sql<number>`(select count(*)::int from ${examSubmissions} s where s.exam_id = ${examId}::uuid and s.student_id = ${studentId}::uuid)`,
      open: sql<number>`(select count(*)::int from ${examSubmissions} s where s.exam_id = ${examId}::uuid and s.student_id = ${studentId}::uuid and s.submitted_at is null)`,
    })
    .from(exams)
    .where(and(eq(exams.id, examId), isNotNull(exams.publishedAt)));
  if (!exam || !exam.reveal || exam.open > 0 || exam.used < exam.maxAttempts) return null;
  const rows = await db
    .select({ questionId: examQuestions.id, correct: examQuestions.correctOption, type: examQuestions.type })
    .from(examQuestions)
    .where(eq(examQuestions.examId, examId));
  return rows
    .filter((r) => (r.type === "multiple_choice" || r.type === "true_false") && r.correct !== null)
    .map((r) => ({ questionId: r.questionId, correct: r.correct as number }));
}
