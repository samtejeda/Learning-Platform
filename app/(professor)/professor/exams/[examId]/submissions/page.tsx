import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getOwnedExam, listSubmissionsForExam } from "@/lib/data/exams";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataList } from "@/components/ui/data-list";

const paramsSchema = z.object({ examId: z.uuid() });

export const metadata = { title: "Exam submissions" };

export default async function ExamSubmissionsPage({ params }: { params: Promise<{ examId: string }> }) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const user = await requireRole("professor", "admin");
  const exam = await getOwnedExam(parsed.data.examId, user);
  if (!exam) notFound();
  const rows = (await listSubmissionsForExam(exam.id, user)) ?? [];

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        back={<BackLink href={`/professor/exams/${exam.id}`}>Back to exam</BackLink>}
        title="Submissions"
        lead="Each attempt is graded separately. A student's grade of record is their highest graded attempt."
      />
      <Card>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No one has started this exam yet.</p>
        ) : (
          <DataList>
            {rows.map((r) => (
              <li key={r.id} className="py-3">
                {r.submittedAt ? (
                  <Link href={`/professor/exams/${exam.id}/submissions/${r.id}`} className="flex flex-wrap items-center gap-2 hover:underline">
                    <span className="font-medium">{r.studentName || r.studentEmail || "Student"}</span>
                    <Badge tone="outline">Attempt {r.attemptNumber}</Badge>
                    <Badge tone="outline">{r.language === "es" ? "Español" : "English"}</Badge>
                    {r.gradedAt ? <Badge tone="success">Graded: {r.grade}</Badge> : <Badge tone="warning">Needs grading</Badge>}
                    {r.gradedAt && r.gradeOfRecord !== null && <span className="text-xs text-muted">Grade of record: {r.gradeOfRecord}</span>}
                  </Link>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.studentName || r.studentEmail || "Student"}</span>
                    <Badge tone="outline">Attempt {r.attemptNumber}</Badge>
                    <Badge tone="neutral">In progress</Badge>
                  </div>
                )}
              </li>
            ))}
          </DataList>
        )}
      </Card>
    </div>
  );
}
