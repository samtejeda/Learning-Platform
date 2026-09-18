import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getCourseForProfessor } from "@/lib/data/courses";
import { inviteStudent, removeStudent, revokeInvitation } from "@/lib/enrollments/actions";
import { Card } from "@/components/ui/card";
import { buttonClassName } from "@/components/ui/button";
import { RosterManager } from "@/components/roster-manager";
import { LectureListManager } from "@/components/lecture-list-manager";
import { LectureUploadForm } from "@/components/lecture-upload-form";

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
  const course = await getCourseForProfessor(parsed.data.courseId, user);
  if (!course) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/professor" className="text-sm text-slate-500 hover:text-slate-900">
          ← My courses
        </Link>
        <div className="flex items-start justify-between gap-4 mt-2">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{course.title}</h1>
            {course.professorName && (
              <p className="text-sm text-slate-500 mt-1">Taught by {course.professorName}</p>
            )}
          </div>
          <Link
            href={`/professor/courses/${course.id}/edit`}
            className={buttonClassName("secondary")}
          >
            Edit
          </Link>
        </div>
        {course.description && (
          <p className="text-slate-700 mt-3 whitespace-pre-line">{course.description}</p>
        )}
      </div>

      <Card>
        <h2 className="font-semibold text-slate-900 mb-3">Lectures</h2>
        <LectureListManager courseId={course.id} lectures={course.lectures} />
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-900 mb-3">Add a lecture</h2>
        <LectureUploadForm courseId={course.id} />
      </Card>

      <Card>
        <h2 className="font-semibold text-slate-900 mb-3">Students</h2>
        {/* Bound ids are re-validated and ownership re-checked inside each action. */}
        <RosterManager
          roster={course.roster}
          invite={inviteStudent.bind(null, course.id)}
          remove={removeStudent.bind(null, course.id)}
          revoke={revokeInvitation.bind(null, course.id)}
        />
      </Card>
    </div>
  );
}
