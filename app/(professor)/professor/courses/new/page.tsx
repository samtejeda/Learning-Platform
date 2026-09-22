import { requireRole } from "@/lib/auth/session";
import { createCourse } from "@/lib/courses/actions";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { CourseForm } from "@/components/course-form";

export const metadata = { title: "New course" };

export default async function NewCoursePage() {
  await requireRole("professor", "admin");

  return (
    <div className="max-w-xl space-y-6 sm:space-y-8">
      <PageHeader
        back={<BackLink href="/professor">Teaching</BackLink>}
        title="New course"
        lead="You can add lectures and invite students once it's created."
      />
      <Card>
        <CourseForm action={createCourse} submitLabel="Create course" pendingLabel="Creating…" />
      </Card>
    </div>
  );
}
