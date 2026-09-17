import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getCourseForProfessor } from "@/lib/data/courses";
import { Card } from "@/components/ui/card";

const paramsSchema = z.object({ courseId: z.uuid() });

export default async function ProfessorCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const user = await requireRole("professor", "admin");
  // Ownership is enforced inside the query (admins bypass). Not-owned → 404.
  const course = await getCourseForProfessor(parsed.data.courseId, user.id, {
    isAdmin: user.role === "admin",
  });
  if (!course) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/professor" className="text-sm text-slate-500 hover:text-slate-900">
          ← My courses
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900 mt-2">{course.title}</h1>
        {course.professorName && (
          <p className="text-sm text-slate-500 mt-1">Taught by {course.professorName}</p>
        )}
        {course.description && <p className="text-slate-700 mt-3">{course.description}</p>}
      </div>

      <Card>
        <h2 className="font-semibold text-slate-900 mb-3">Lectures</h2>
        {course.lectures.length === 0 ? (
          <p className="text-sm text-slate-500">No lectures yet.</p>
        ) : (
          <ol className="divide-y divide-slate-100">
            {course.lectures.map((lecture, i) => (
              <li key={lecture.id} className="py-2.5 text-sm text-slate-700 flex gap-3">
                <span className="text-slate-400 w-6 shrink-0 tabular-nums">{i + 1}.</span>
                <span>{lecture.title}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
