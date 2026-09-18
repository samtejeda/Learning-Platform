import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getCourseForProfessor } from "@/lib/data/courses";
import { inviteStudent, removeStudent, revokeInvitation } from "@/lib/enrollments/actions";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { DataList, DataRow, DataRowIndex, DataRowMain } from "@/components/ui/data-list";
import { RosterManager } from "@/components/roster-manager";
import { formatTime } from "@/lib/video/format-time";

const paramsSchema = z.object({ courseId: z.uuid() });

const STATUS: Record<"pending_upload" | "draft" | "published", { label: string; tone: "warning" | "outline" | "success" }> = {
  pending_upload: { label: "Upload pending", tone: "warning" },
  draft: { label: "Draft", tone: "outline" },
  published: { label: "Published", tone: "success" },
};

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
        <div className="mb-2 flex items-center justify-between gap-3">
          <CardTitle>Lectures</CardTitle>
          <span className="text-sm text-muted">{course.lectures.length}</span>
        </div>
        {course.lectures.length === 0 ? (
          <p className="text-sm text-muted">No lectures yet.</p>
        ) : (
          <DataList>
            {course.lectures.map((lecture, i) => {
              const status = STATUS[lecture.status];
              return (
                <DataRow key={lecture.id}>
                  <DataRowIndex>{i + 1}</DataRowIndex>
                  <DataRowMain
                    title={lecture.title}
                    meta={
                      lecture.durationSeconds ? <span>{formatTime(lecture.durationSeconds)}</span> : undefined
                    }
                  />
                  <Badge tone={status.tone}>{status.label}</Badge>
                </DataRow>
              );
            })}
          </DataList>
        )}
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
