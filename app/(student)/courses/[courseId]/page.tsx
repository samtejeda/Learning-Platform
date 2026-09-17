import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getCourseForStudent } from "@/lib/data/courses";
import { Card } from "@/components/ui/card";

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
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-900">
          ← My courses
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900 mt-2">{course.title}</h1>
        {course.professorName && (
          <p className="text-sm text-slate-500 mt-1">Taught by {course.professorName}</p>
        )}
        {course.description && <p className="text-slate-700 mt-3">{course.description}</p>}
      </div>

      {course.lectures.length > 0 && (
        <Card>
          <h2 className="font-semibold text-slate-900 mb-3">Lectures</h2>
          <ol className="divide-y divide-slate-100">
            {course.lectures.map((lecture, i) => (
              <li key={lecture.id} className="py-2.5 text-sm text-slate-700 flex gap-3">
                <span className="text-slate-400 w-6 shrink-0 tabular-nums">{i + 1}.</span>
                <span>{lecture.title}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
