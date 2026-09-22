import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getCourseForProfessor } from "@/lib/data/courses";
import { updateCourse } from "@/lib/courses/actions";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { CourseForm } from "@/components/course-form";

const paramsSchema = z.object({ courseId: z.uuid() });

export const metadata = { title: "Edit course" };

export default async function EditCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const user = await requireRole("professor", "admin");
  const course = await getCourseForProfessor(parsed.data.courseId, user);
  if (!course) notFound();

  // The bound id is re-validated and ownership re-checked inside the action.
  const action = updateCourse.bind(null, course.id);

  return (
    <div className="max-w-xl space-y-6 sm:space-y-8">
      <PageHeader
        back={<BackLink href={`/professor/courses/${course.id}`}>{course.title}</BackLink>}
        title="Edit course"
      />
      <Card>
        <CourseForm
          action={action}
          initial={{ title: course.title, description: course.description }}
          submitLabel="Save changes"
          pendingLabel="Saving…"
        />
      </Card>
    </div>
  );
}
