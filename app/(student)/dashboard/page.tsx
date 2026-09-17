import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listEnrolledCourses } from "@/lib/data/courses";
import { Card } from "@/components/ui/card";

export const metadata = { title: "My courses" };

export default async function StudentDashboardPage() {
  const user = await requireUser();
  const enrolled = await listEnrolledCourses(user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">My courses</h1>
        <p className="text-sm text-slate-500 mt-1">
          {user.fullName ? `Welcome back, ${user.fullName}.` : "Welcome back."}
        </p>
      </div>

      {enrolled.length === 0 ? (
        <Card>
          <p className="text-slate-700 font-medium">You aren&apos;t enrolled in any courses yet.</p>
          <p className="text-sm text-slate-500 mt-1">
            Once a professor enrolls you, your courses will appear here.
          </p>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {enrolled.map((course) => (
            <li key={course.id}>
              <Link
                href={`/courses/${course.id}`}
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
