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
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader back={back} title={attempt.title ?? "Exam"} eyebrow={`Attempt ${attempt.attemptNumber} · submitted`} />
      {attempt.grade !== null ? (
        <Alert tone="success">
          <p className="font-medium">Grade: {attempt.grade}</p>
          {attempt.feedback && <p className="mt-1 whitespace-pre-wrap">{attempt.feedback}</p>}
        </Alert>
      ) : (
        <Alert tone="info">Submitted. Your professor will grade this by hand.</Alert>
      )}
      {attempt.questions.map((q, i) => {
        const a = byQuestion.get(q.id);
        const choice =
          a?.selectedOption != null
            ? q.type === "true_false"
              ? TRUE_FALSE_LABELS[attempt.language][a.selectedOption]
              : q.options?.[a.selectedOption]
            : null;
        return (
          <Card key={q.id}>
            <p className="text-[15px] font-medium">
              {i + 1}. {q.prompt}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{choice ?? a?.answerText ?? "(no answer)"}</p>
            {a?.feedback && <p className="mt-2 whitespace-pre-wrap text-sm text-muted">Comment: {a.feedback}</p>}
          </Card>
        );
      })}
    </div>
  );
}
