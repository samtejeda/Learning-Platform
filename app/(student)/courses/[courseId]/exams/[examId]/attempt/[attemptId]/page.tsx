import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getAttemptForStudent } from "@/lib/data/exam-attempts";
import { TRUE_FALSE_LABELS } from "@/lib/exams/language";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { ExamAttemptForm } from "@/components/exams/exam-attempt-form";

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
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader back={back} title={attempt.title ?? "Exam"} eyebrow={`Attempt ${attempt.attemptNumber} · submitted`} />
      {result && (
        <Card>
          <p className="text-xs font-medium text-muted">Result</p>
          {result.legacy ? (
            <p className="mt-0.5 font-display text-4xl tabular-nums text-ink">Grade: {result.percent}</p>
          ) : result.status === "final" ? (
            <p className="mt-0.5 font-display text-4xl tabular-nums text-ink">
              {result.totalPoints} of {result.totalMax} points
            </p>
          ) : (
            <>
              <p className="mt-0.5 text-lg text-ink">
                {result.autoPoints} of {result.autoMax} auto-graded points
                {result.pendingManualMax > 0 ? `, ${result.pendingManualMax} pending manual grading` : ""}
              </p>
              <p className="mt-1 text-sm text-muted">
                Awaiting your professor: question{result.pending.length === 1 ? "" : "s"} {result.pending.map((p) => p.number).join(", ")}.
              </p>
            </>
          )}
          {attempt.feedback && (
            <div className="mt-4 border-t border-hairline pt-4">
              <p className="text-xs font-medium text-muted">Feedback from your professor</p>
              <p className="mt-1 whitespace-pre-wrap text-[15px] text-body">{attempt.feedback}</p>
            </div>
          )}
        </Card>
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
          const answer = choice ?? (a?.blankAnswers ? a.blankAnswers.map((b, n) => `${n + 1}. ${b || "—"}`).join("\n") : a?.answerText);
          const o = outcome.get(q.id);
          const key = revealed.get(q.id);
          const keyLabel = key === undefined ? null : q.type === "true_false" ? TRUE_FALSE_LABELS[attempt.language][key] : q.options?.[key];
          return (
            <li key={q.id}>
              <Card variant="outlined" className="sm:p-6">
                <p className="mb-1 text-xs font-medium tabular-nums text-muted">
                  Question {i + 1} of {attempt.questions.length}
                </p>
                <p className="whitespace-pre-line text-base font-medium text-ink">{q.prompt}</p>
                <div className="mt-3 rounded-md bg-surface-soft px-3.5 py-3">
                  <p className="text-xs font-medium text-muted">Your answer</p>
                  <p className={`mt-0.5 whitespace-pre-wrap break-words text-[15px] ${answer ? "text-ink" : "text-muted"}`}>
                    {answer || "(no answer)"}
                  </p>
                </div>
                {o && (
                  <p className="mt-2 text-sm text-body">
                    {o.state === "correct" && `Correct (${o.points} of ${o.maxPoints})`}
                    {o.state === "incorrect" && `Incorrect (0 of ${o.maxPoints})`}
                    {o.state === "unanswered" && `Not answered (0 of ${o.maxPoints})`}
                    {o.state === "awaiting" && `Awaiting manual grading (${o.maxPoints} points)`}
                    {o.state === "graded" && `${o.points} of ${o.maxPoints} points`}
                  </p>
                )}
                {keyLabel && <p className="mt-1 text-sm text-body">Correct answer: {keyLabel}</p>}
                {a?.feedback && (
                  <div className="mt-3 border-l-2 border-primary pl-3">
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
