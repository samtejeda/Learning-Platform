import { notFound } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getExamLandingForStudent } from "@/lib/data/exam-attempts";
import { startExamAttempt } from "@/lib/exams/actions";
import { DEFAULT_CONTENT_LANGUAGE } from "@/lib/exams/language";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { StartAttemptForm } from "@/components/exams/start-attempt-form";

const paramsSchema = z.object({ courseId: z.uuid(), examId: z.uuid() });

export const metadata = { title: "Exam" };

export default async function StudentExamPage({
  params,
}: {
  params: Promise<{ courseId: string; examId: string }>;
}) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const user = await requireUser();
  // Enrollment + published are joined inside the query (404 otherwise).
  const exam = await getExamLandingForStudent(parsed.data.examId, user.id, DEFAULT_CONTENT_LANGUAGE);
  if (!exam || exam.courseId !== parsed.data.courseId) notFound();

  const attemptsLeft = exam.maxAttempts - exam.attemptsUsed;
  const base = `/courses/${exam.courseId}/exams/${exam.id}`;

  return (
    <div className="max-w-2xl space-y-6 sm:space-y-8">
      <PageHeader
        back={<BackLink href={`/courses/${exam.courseId}`}>Course</BackLink>}
        title={exam.title ?? "Exam"}
        lead={exam.description}
      />
      <Card>
        <p className="text-sm text-muted">
          {exam.questionCount} questions · {exam.durationMinutes} minutes once you start · {Math.max(0, attemptsLeft)} of {exam.maxAttempts} attempts left
        </p>
        {exam.gradeOfRecord !== null && <p className="mt-2 text-sm font-medium">Your grade: {exam.gradeOfRecord} (highest graded attempt)</p>}
        {(exam.openAttemptId || attemptsLeft > 0) && (
          <div className="mt-4">
            <StartAttemptForm
              action={startExamAttempt.bind(null, exam.id, exam.courseId)}
              defaultLanguage={DEFAULT_CONTENT_LANGUAGE}
              resuming={exam.openAttemptId !== null}
            />
          </div>
        )}
      </Card>

      {exam.attempts.length > 0 && (
        <Card>
          <CardTitle>Your attempts</CardTitle>
          <ul className="mt-3 divide-y divide-hairline">
            {exam.attempts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 py-3">
                <Link href={`${base}/attempt/${a.id}`} className="font-medium hover:underline">
                  Attempt {a.attemptNumber}
                </Link>
                {a.submittedAt === null ? (
                  <Badge tone="neutral">In progress</Badge>
                ) : a.grade !== null ? (
                  <Badge tone="success">Grade: {a.grade}</Badge>
                ) : (
                  <Badge tone="outline">Awaiting grading</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
