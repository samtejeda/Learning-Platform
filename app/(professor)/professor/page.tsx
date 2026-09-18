import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { listAllCourses, listTaughtCourses, type CourseSummary } from "@/lib/data/courses";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClassName } from "@/components/ui/button";
import { CourseCard } from "@/components/course-card";

export const metadata = { title: "Teaching" };

export default async function ProfessorDashboardPage() {
  const user = await requireRole("professor", "admin");
  const isAdmin = user.role === "admin";
  // Admins see every course (with its professor); professors see their own.
  const taught: (CourseSummary & { professorName?: string | null })[] = isAdmin
    ? await listAllCourses()
    : await listTaughtCourses(user.id);

  const newCourse = (
    <Link href="/professor/courses/new" className={buttonClassName("primary")}>
      New course
    </Link>
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        title={isAdmin ? "All courses" : "Teaching"}
        lead={isAdmin ? "Every course on the platform." : "Courses you teach."}
        actions={newCourse}
      />

      {taught.length === 0 ? (
        <EmptyState
          title="No courses yet."
          description="Create your first course to get started."
          action={newCourse}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {taught.map((course) => (
            <li key={course.id}>
              <CourseCard
                href={`/professor/courses/${course.id}`}
                title={course.title}
                description={course.description}
                footer={
                  course.professorName ? (
                    <p className="text-xs text-muted">Taught by {course.professorName}</p>
                  ) : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
