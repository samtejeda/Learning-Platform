import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getOwnedExam, listSubmissionsForExam } from "@/lib/data/exams";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { DataList, DataRow, DataRowMain } from "@/components/ui/data-list";
import { RowChevron } from "@/components/ui/row-chevron";

const paramsSchema = z.object({ examId: z.uuid() });

export const metadata = { title: "Exam submissions" };

export default async function ExamSubmissionsPage({ params }: { params: Promise<{ examId: string }> }) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const user = await requireRole("professor", "admin");
  const exam = await getOwnedExam(parsed.data.examId, user);
  if (!exam) notFound();
  const rows = (await listSubmissionsForExam(exam.id, user)) ?? [];

  const needGrading = rows.filter((r) => r.score?.status === "pending").length;

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        back={<BackLink href={`/professor/exams/${exam.id}`}>Back to exam</BackLink>}
        title="Submissions"
        lead="Each attempt is graded separately. Multiple choice and true/false score themselves; you award points for the rest. A student's grade of record is their highest final attempt."
      />
      <Card>
        <div className="mb-2 flex items-center justify-between gap-3">
          <CardTitle>Attempts</CardTitle>
          <span className="text-sm tabular-nums text-muted">
            {rows.length === 0 ? "None yet" : needGrading > 0 ? `${needGrading} to grade` : "All graded"}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No one has started this exam yet.</p>
        ) : (
          <DataList>
            {rows.map((r) => {
              const name = r.studentName || r.studentEmail || "Student";
              const meta = (
                <>
                  <span>Attempt {r.attemptNumber}</span>
                  <span aria-hidden>·</span>
                  <span>{r.language === "es" ? "Español" : "English"}</span>
                  {r.gradeOfRecord !== null && (
                    <>
                      <span aria-hidden>·</span>
                      <span>Grade of record: {r.gradeOfRecord}</span>
                    </>
                  )}
                </>
              );
              const badge = !r.submittedAt ? (
                <Badge tone="neutral">In progress</Badge>
              ) : r.score?.status === "final" ? (
                <Badge tone="success">
                  {r.score.legacy ? `Graded: ${r.grade}` : `${r.score.totalPoints} of ${r.score.totalMax} points`}
                </Badge>
              ) : (
                <Badge tone="warning">Needs grading</Badge>
              );
              return (
                <li key={r.id}>
                  {r.submittedAt ? (
                    <Link
                      href={`/professor/exams/${exam.id}/submissions/${r.id}`}
                      className="-mx-2 flex min-h-14 items-center gap-3 rounded-md px-2 py-3 hover:bg-surface-cream-strong/60 focus-visible:focus-ring"
                    >
                      <DataRowMain title={name} meta={meta} />
                      {badge}
                      <RowChevron />
                    </Link>
                  ) : (
                    <DataRow>
                      <DataRowMain title={name} meta={meta} />
                      {badge}
                    </DataRow>
                  )}
                </li>
              );
            })}
          </DataList>
        )}
      </Card>
    </div>
  );
}
