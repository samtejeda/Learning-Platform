import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getCourseForStudent } from "@/lib/data/courses";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { DataList, DataRow, DataRowIndex, DataRowMain } from "@/components/ui/data-list";

const paramsSchema = z.object({ courseId: z.uuid() });

export default async function StudentCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const user = await requireUser();
  // Enrollment is enforced inside the query; an unenrolled course is a 404,
  // not a 403, so we don't confirm which course ids exist.
  const course = await getCourseForStudent(parsed.data.courseId, user.id);
  if (!course) notFound();

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        back={<BackLink href="/dashboard">My courses</BackLink>}
        title={course.title}
        eyebrow={course.professorName ? `Taught by ${course.professorName}` : undefined}
        lead={course.description}
      />

      {/* Sections appear only when they have content. */}
      {course.lectures.length > 0 && (
        <Card>
          <CardTitle className="mb-2">Lectures</CardTitle>
          <DataList>
            {course.lectures.map((lecture, i) => (
              <DataRow key={lecture.id}>
                <DataRowIndex>{i + 1}</DataRowIndex>
                <DataRowMain title={lecture.title} />
              </DataRow>
            ))}
          </DataList>
        </Card>
      )}
    </div>
  );
}
