import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getCourseForProfessor } from "@/lib/data/courses";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { DataList, DataRow, DataRowIndex, DataRowMain } from "@/components/ui/data-list";

const paramsSchema = z.object({ courseId: z.uuid() });

export default async function ProfessorCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const user = await requireRole("professor", "admin");
  // Ownership is enforced inside the query (admins bypass). Not-owned → 404.
  const course = await getCourseForProfessor(parsed.data.courseId, user.id, {
    isAdmin: user.role === "admin",
  });
  if (!course) notFound();

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        back={<BackLink href="/professor">Teaching</BackLink>}
        title={course.title}
        eyebrow={course.professorName ? `Taught by ${course.professorName}` : undefined}
        lead={course.description}
      />

      <Card>
        <CardTitle className="mb-2">Lectures</CardTitle>
        {course.lectures.length === 0 ? (
          <p className="text-sm text-muted">No lectures yet.</p>
        ) : (
          <DataList>
            {course.lectures.map((lecture, i) => (
              <DataRow key={lecture.id}>
                <DataRowIndex>{i + 1}</DataRowIndex>
                <DataRowMain title={lecture.title} />
              </DataRow>
            ))}
          </DataList>
        )}
      </Card>
    </div>
  );
}
