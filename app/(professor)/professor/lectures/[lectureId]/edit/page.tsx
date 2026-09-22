import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getOwnedLecture } from "@/lib/data/lectures";
import { updateLecture } from "@/lib/lectures/actions";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { CourseForm } from "@/components/course-form";

const paramsSchema = z.object({ lectureId: z.uuid() });

export const metadata = { title: "Edit lecture" };

export default async function EditLecturePage({
  params,
}: {
  params: Promise<{ lectureId: string }>;
}) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const user = await requireRole("professor", "admin");
  // Ownership of the parent course is joined inside the query.
  const lecture = await getOwnedLecture(parsed.data.lectureId, user);
  if (!lecture) notFound();

  return (
    <div className="max-w-xl space-y-6 sm:space-y-8">
      <PageHeader
        back={<BackLink href={`/professor/courses/${lecture.courseId}`}>Back to course</BackLink>}
        title="Edit lecture"
        lead="Title and description only. To replace the video, delete the lecture and upload again."
      />
      <Card>
        {/* Same field names as a course (title, description); the bound id is re-checked in the action. */}
        <CourseForm
          action={updateLecture.bind(null, lecture.id)}
          initial={{ title: lecture.title, description: lecture.description }}
          submitLabel="Save changes"
          pendingLabel="Saving…"
        />
      </Card>
    </div>
  );
}
