import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { createCourse } from "@/lib/courses/actions";
import { Card } from "@/components/ui/card";
import { CourseForm } from "@/components/course-form";

export const metadata = { title: "New course" };

export default async function NewCoursePage() {
  await requireRole("professor", "admin");

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <Link href="/professor" className="text-sm text-slate-500 hover:text-slate-900">
          ← My courses
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900 mt-2">New course</h1>
      </div>
      <Card>
        <CourseForm action={createCourse} submitLabel="Create course" pendingLabel="Creating…" />
      </Card>
    </div>
  );
}
