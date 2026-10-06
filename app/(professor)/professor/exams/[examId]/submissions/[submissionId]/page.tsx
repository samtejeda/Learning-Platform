import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getSubmissionForGrading } from "@/lib/data/exams";
import { gradeSubmission } from "@/lib/exams/actions";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { ExamGradeForm } from "@/components/exams/exam-grade-form";

const paramsSchema = z.object({ examId: z.uuid(), submissionId: z.uuid() });

export const metadata = { title: "Grade attempt" };

export default async function GradeSubmissionPage({
  params,
}: {
  params: Promise<{ examId: string; submissionId: string }>;
}) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const user = await requireRole("professor", "admin");
  // Ownership is joined inside the query; the URL's exam id must match too.
  const submission = await getSubmissionForGrading(parsed.data.submissionId, user);
  if (!submission || submission.examId !== parsed.data.examId) notFound();

  return (
    <div className="max-w-3xl space-y-6 sm:space-y-8">
      <PageHeader
        back={<BackLink href={`/professor/exams/${submission.examId}/submissions`}>Submissions</BackLink>}
        title={submission.studentName || submission.studentEmail || "Student"}
        eyebrow={`Attempt ${submission.attemptNumber} · answered in ${submission.language === "es" ? "Español" : "English"}`}
        lead="Nothing is scored automatically. The key is shown beside each answer for your reference only."
      />
      <ExamGradeForm action={gradeSubmission.bind(null, submission.id)} submission={submission} />
    </div>
  );
}
