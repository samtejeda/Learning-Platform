import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getAttemptForStudent, getExamLandingForStudent } from "@/lib/data/exam-attempts";
import { TRUE_FALSE_LABELS } from "@/lib/exams/language";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { Card } from "@/components/ui/card";
import { ExamAttemptForm } from "@/components/exams/exam-attempt-form";
import { BlankPrompt } from "@/components/exams/blank-prompt";
import { QuestionOutcome } from "@/components/exams/question-outcome";
import { ResultSummary } from "@/components/exams/result-summary";

const paramsSchema = z.object({ courseId: z.uuid(), examId: z.uuid(), attemptId: z.uuid() });

export const metadata = { title: "Exam attempt" };

export default async function AttemptPage({
  params,
}: {
  params: Promise<{ courseId: string; examId: string; attemptId: string }>;
}) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const user = await requireUser();
  // The attempt must be the caller's own, in a course they're enrolled in.
  const attempt = await getAttemptForStudent(parsed.data.attemptId, user.id);
  if (!attempt || attempt.examId !== parsed.data.examId || attempt.courseId !== parsed.data.courseId) notFound();

  const back = <BackLink href={`/courses/${attempt.courseId}/exams/${attempt.examId}`}>Exam</BackLink>;

  if (attempt.status === "in_progress") {
    return (
      <div className="max-w-2xl space-y-6">
        <PageHeader back={back} title={attempt.title ?? "Exam"} eyebrow={`Attempt ${attempt.attemptNumber}`} lead={attempt.description} />
        <ExamAttemptForm
          attemptId={attempt.id}
          language={attempt.language}
          deadlineIso={attempt.deadline.toISOString()}
          questions={attempt.questions}
          saved={attempt.answers}
        />
      </div>
    );
  }

  const byQuestion = new Map(attempt.answers.map((a) => [a.questionId, a]));
  const result = attempt.result;
  const outcome = new Map((result?.perQuestion ?? []).map((p) => [p.questionId, p]));
  const revealed = new Map((attempt.revealedAnswers ?? []).map((k) => [k.questionId, k.correct]));
  // Attempts left, from the same read the exam page uses (enrolled + published inside the query).
  const landing = await getExamLandingForStudent(attempt.examId, user.id, attempt.language);
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader back={back} title={attempt.title ?? "Exam"} eyebrow={`Attempt ${attempt.attemptNumber} · submitted`} />
      {result && (
        <ResultSummary
          result={result}
          feedback={attempt.feedback}
          attemptsUsed={landing?.attemptsUsed ?? attempt.attemptNumber}
          maxAttempts={landing?.maxAttempts ?? attempt.attemptNumber}
          gradeOfRecord={landing?.gradeOfRecord ?? null}
          examHref={`/courses/${attempt.courseId}/exams/${attempt.examId}`}
        />
      )}
      <ol className="space-y-4">
        {attempt.questions.map((q, i) => {
          const a = byQuestion.get(q.id);
          const choice =
            a?.selectedOption != null
              ? q.type === "true_false"
                ? TRUE_FALSE_LABELS[attempt.language][a.selectedOption]
                : q.options?.[a.selectedOption]
              : null;
          const blankAnswers = q.type === "fill_in_the_blank" && q.blankCount > 0 ? (a?.blankAnswers ?? []) : null;
          const answer = choice ?? a?.answerText;
          const o = outcome.get(q.id);
          const key = revealed.get(q.id);
          const keyLabel = key === undefined ? null : q.type === "true_false" ? TRUE_FALSE_LABELS[attempt.language][key] : q.options?.[key];
          return (
            <li key={q.id} id={`question-${i + 1}`} className="scroll-mt-20">
              <Card variant="outlined" className="space-y-3 sm:p-6">
                <p className="text-xs font-medium tabular-nums text-muted">
                  Question {i + 1} of {attempt.questions.length}
                </p>
                {blankAnswers ? (
                  <BlankPrompt prompt={q.prompt} answers={blankAnswers} />
                ) : (
                  <>
                    <p className="whitespace-pre-line text-base font-medium text-ink">{q.prompt}</p>
                    <div className="rounded-md bg-surface-soft px-3.5 py-3">
                      <p className="text-xs font-medium text-muted">Your answer</p>
                      <p className={`mt-0.5 whitespace-pre-wrap break-words text-[15px] ${answer ? "text-ink" : "text-muted"}`}>
                        {answer || "(no answer)"}
                      </p>
                    </div>
                  </>
                )}
                {o && <QuestionOutcome outcome={o} />}
                {keyLabel && (
                  <p className="rounded-md border border-hairline px-3.5 py-2.5 text-sm text-body">
                    <span className="font-medium text-ink">Correct answer:</span> {keyLabel}
                  </p>
                )}
                {a?.feedback && (
                  <div className="border-l-2 border-primary pl-3">
                    <p className="text-xs font-medium text-muted">Comment from your professor</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-body">{a.feedback}</p>
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
