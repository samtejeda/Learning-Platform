import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getOwnedExam } from "@/lib/data/exams";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { buttonClassName } from "@/components/ui/button";
import { ExamBuilder } from "@/components/exams/exam-builder";

const paramsSchema = z.object({ examId: z.uuid() });

export const metadata = { title: "Exam" };

export default async function ProfessorExamPage({ params }: { params: Promise<{ examId: string }> }) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const user = await requireRole("professor", "admin");
  // Ownership of the parent course is joined inside the query.
  const exam = await getOwnedExam(parsed.data.examId, user);
  if (!exam) notFound();

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        back={<BackLink href={`/professor/courses/${exam.courseId}`}>Back to course</BackLink>}
        title={exam.titleEn || exam.titleEs || "Untitled exam"}
        lead="Both languages are required before you can publish. Exams are graded by you; nothing is scored automatically."
        actions={
          exam.status === "published" ? (
            <Link href={`/professor/exams/${exam.id}/submissions`} className={buttonClassName("secondary")}>
              Submissions
            </Link>
          ) : undefined
        }
      />
      <ExamBuilder exam={exam} />
    </div>
  );
}
