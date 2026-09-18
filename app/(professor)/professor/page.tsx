import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { listAllCourses, listTaughtCourses } from "@/lib/data/courses";
import { Card } from "@/components/ui/card";
import { buttonClassName } from "@/components/ui/button";

export const metadata = { title: "Teaching" };

export default async function ProfessorDashboardPage() {
  const user = await requireRole("professor", "admin");
  const isAdmin = user.role === "admin";
  const taught = isAdmin ? await listAllCourses() : await listTaughtCourses(user.id);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {isAdmin ? "All courses" : "My courses"}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {isAdmin ? "Every course on the platform." : "Courses you teach."}
          </p>
        </div>
        <Link href="/professor/courses/new" className={buttonClassName("primary")}>
          New course
        </Link>
      </div>

      {taught.length === 0 ? (
        <Card>
          <p className="text-slate-700 font-medium">No courses yet.</p>
          <p className="text-sm text-slate-500 mt-1">Create your first course to get started.</p>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {taught.map((course) => (
            <li key={course.id}>
              <Link
                href={`/professor/courses/${course.id}`}
                className="block h-full bg-white rounded-2xl shadow-sm border border-slate-200 p-5 hover:border-slate-400 transition-colors"
              >
                <h2 className="font-semibold text-slate-900">{course.title}</h2>
                {course.description && (
                  <p className="text-sm text-slate-500 mt-1 line-clamp-2">{course.description}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
