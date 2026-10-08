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
import { DataList } from "@/components/ui/data-list";
import { ProgressBar } from "@/components/ui/progress-bar";
import { RowChevron } from "@/components/ui/row-chevron";
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

  const used = Math.min(exam.attemptsUsed, exam.maxAttempts);
  const canStart = exam.openAttemptId !== null || attemptsLeft > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6 sm:space-y-8">
      <PageHeader
        back={<BackLink href={`/courses/${exam.courseId}`}>Course</BackLink>}
        crumbs={[
          { label: "My courses", href: "/dashboard" },
          { label: "Course", href: `/courses/${exam.courseId}` },
          { label: "Exams", href: `/courses/${exam.courseId}#exams` },
          { label: exam.title ?? "Exam" },
        ]}
        title={exam.title ?? "Exam"}
        lead={exam.description}
      />
      <Card>
        <dl className="grid grid-cols-3 gap-3 text-center sm:text-left">
          <div>
            <dt className="text-xs text-muted">Questions</dt>
            <dd className="mt-0.5 text-2xl font-medium tabular-nums text-ink">{exam.questionCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Minutes</dt>
            <dd className="mt-0.5 text-2xl font-medium tabular-nums text-ink">{exam.durationMinutes}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Attempts left</dt>
            <dd className="mt-0.5 text-2xl font-medium tabular-nums text-ink">{Math.max(0, attemptsLeft)}</dd>
          </div>
        </dl>
        <div className="mt-4">
          <ProgressBar value={(used / exam.maxAttempts) * 100} label="Attempts used" caption={`${used} of ${exam.maxAttempts} used`} />
        </div>
        {exam.gradeOfRecord !== null && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
            <Badge tone="success">Your grade: {exam.gradeOfRecord}%</Badge>
            <span className="text-xs text-muted">Highest graded attempt</span>
          </div>
        )}
      </Card>

      <Card variant="outlined">
        <CardTitle>{exam.openAttemptId ? "Attempt in progress" : "Start an attempt"}</CardTitle>
        {canStart ? (
          <>
            <p className="mb-4 mt-1 text-sm text-muted">
              {exam.openAttemptId
                ? "Pick up where you left off. The clock keeps running."
                : "The clock starts when you press Start attempt."}
            </p>
            <StartAttemptForm
              action={startExamAttempt.bind(null, exam.id, exam.courseId)}
              defaultLanguage={DEFAULT_CONTENT_LANGUAGE}
              resuming={exam.openAttemptId !== null}
            />
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">You have used all of your attempts.</p>
        )}
      </Card>

      {exam.attempts.length > 0 && (
        <Card>
          <CardTitle>Your attempts</CardTitle>
          <DataList className="mt-2">
            {exam.attempts.map((a) => (
              <li key={a.id}>
                <Link
                  href={`${base}/attempt/${a.id}`}
                  className="-mx-2 flex min-h-14 items-center gap-3 rounded-md px-2 py-3 hover:bg-surface-cream-strong/60 focus-visible:focus-ring"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium text-ink">Attempt {a.attemptNumber}</div>
                    {a.score && !a.score.legacy && (
                      <div className="mt-0.5 text-xs tabular-nums text-muted">
                        {a.score.totalPoints} of {a.score.totalMax} {a.score.totalMax === 1 ? "point" : "points"}
                        {a.score.status === "pending" ? " so far" : ""}
                      </div>
                    )}
                  </div>
                  {a.submittedAt === null ? (
                    <Badge tone="neutral">In progress</Badge>
                  ) : a.score?.status === "final" ? (
                    <Badge tone="success">{a.score.percent ?? a.grade}%</Badge>
                  ) : (
                    <Badge tone="warning">Pending</Badge>
                  )}
                  <RowChevron />
                </Link>
              </li>
            ))}
          </DataList>
        </Card>
      )}
    </div>
  );
}
