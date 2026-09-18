import { requireRole } from "@/lib/auth/session";
import { listAllCourses, listTaughtCourses } from "@/lib/data/courses";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CourseCard } from "@/components/course-card";

export const metadata = { title: "Teaching" };

export default async function ProfessorDashboardPage() {
  const user = await requireRole("professor", "admin");
  const isAdmin = user.role === "admin";
  const taught = isAdmin ? await listAllCourses() : await listTaughtCourses(user.id);

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        title={isAdmin ? "All courses" : "Teaching"}
        lead={isAdmin ? "Every course on the platform." : "Courses you teach."}
      />

      {taught.length === 0 ? (
        <EmptyState
          title="No courses yet."
          description="Course creation is coming in the next build phase."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {taught.map((course) => (
            <li key={course.id}>
              <CourseCard
                href={`/professor/courses/${course.id}`}
                title={course.title}
                description={course.description}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
