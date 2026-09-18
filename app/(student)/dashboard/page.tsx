import { requireUser } from "@/lib/auth/session";
import { listEnrolledCoursesWithProgress } from "@/lib/data/courses";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { CourseCard } from "@/components/course-card";

export const metadata = { title: "My courses" };

export default async function StudentDashboardPage() {
  const user = await requireUser();
  const enrolled = await listEnrolledCoursesWithProgress(user.id);

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        title="My courses"
        lead={user.fullName ? `Welcome back, ${user.fullName}.` : "Welcome back."}
      />

      {enrolled.length === 0 ? (
        <EmptyState
          title="You aren't enrolled in any courses yet."
          description="Once a professor enrolls you, your courses will appear here."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {enrolled.map((course) => (
            <li key={course.id}>
              <CourseCard
                href={`/courses/${course.id}`}
                title={course.title}
                description={course.description}
                footer={
                  course.lectureCount === 0 ? (
                    <p className="text-xs text-muted">No lectures published yet</p>
                  ) : (
                    <ProgressBar
                      value={(course.completedCount / course.lectureCount) * 100}
                      label={`${course.title}: lectures completed`}
                      caption={
                        course.completedCount === course.lectureCount
                          ? "Complete"
                          : `${course.completedCount} of ${course.lectureCount}`
                      }
                    />
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
