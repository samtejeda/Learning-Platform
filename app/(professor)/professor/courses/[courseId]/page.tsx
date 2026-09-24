import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getCourseForProfessor } from "@/lib/data/courses";
import { inviteStudent, removeStudent, revokeInvitation } from "@/lib/enrollments/actions";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { buttonClassName } from "@/components/ui/button";
import { RosterManager } from "@/components/roster-manager";
import { LectureListManager } from "@/components/lecture-list-manager";
import { LectureUploadForm } from "@/components/lecture-upload-form";
import { SyllabusManager } from "@/components/syllabus-manager";
import { SyllabusViewer } from "@/components/syllabus-viewer";
import { CourseMaterialsManager } from "@/components/course-materials-manager";
import { CourseMaterialForm } from "@/components/course-material-form";

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

  const published = course.lectures.filter((l) => l.status === "published").length;
  const enrolledCount = course.roster.enrolled.length;
  const invitedCount = course.roster.invited.length;

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        back={<BackLink href="/professor">Teaching</BackLink>}
        title={course.title}
        eyebrow={course.professorName ? `Taught by ${course.professorName}` : undefined}
        lead={course.description}
        actions={
          <Link href={`/professor/courses/${course.id}/edit`} className={buttonClassName("secondary")}>
            Edit details
          </Link>
        }
      />

      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <CardTitle>Lectures</CardTitle>
          <span className="text-sm tabular-nums text-muted">
            {course.lectures.length === 0
              ? "None yet"
              : `${published} of ${course.lectures.length} published`}
          </span>
        </div>
        <LectureListManager courseId={course.id} lectures={course.lectures} />
      </Card>

      <Card variant="outlined">
        <CardTitle>Add a lecture</CardTitle>
        <p className="mb-5 mt-1 text-sm text-muted">
          Upload the video, then publish it when you&apos;re ready. Students only see published lectures.
        </p>
        <LectureUploadForm courseId={course.id} />
      </Card>

      <Card>
        <CardTitle>Syllabus</CardTitle>
        <p className="mb-4 mt-1 text-sm text-muted">
          One PDF, visible to students as soon as it&apos;s uploaded — there&apos;s no separate publish step.
        </p>
        <SyllabusManager
          courseId={course.id}
          uploadedAt={course.syllabusUploadedAt ? course.syllabusUploadedAt.toISOString() : null}
        />
        {course.syllabusUploadedAt && (
          <div className="mt-6 border-t border-hairline pt-6">
            <p className="mb-3 text-sm font-medium text-ink">Preview</p>
            <SyllabusViewer courseId={course.id} />
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <CardTitle>Course materials</CardTitle>
          <span className="text-sm tabular-nums text-muted">
            {course.materials.length === 0
              ? "None yet"
              : `${course.materials.filter((m) => m.status === "published").length} of ${course.materials.length} published`}
          </span>
        </div>
        <CourseMaterialsManager courseId={course.id} materials={course.materials} />
      </Card>

      <Card variant="outlined">
        <CardTitle>Add a material</CardTitle>
        <p className="mb-5 mt-1 text-sm text-muted">
          Upload a file or add a link, then publish it when you&apos;re ready. Students only see published
          materials.
        </p>
        <CourseMaterialForm courseId={course.id} />
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <CardTitle>Students</CardTitle>
          <span className="text-sm text-muted">
            {enrolledCount} enrolled{invitedCount > 0 ? ` · ${invitedCount} invited` : ""}
          </span>
        </div>
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
