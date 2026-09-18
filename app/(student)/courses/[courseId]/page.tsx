import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getCourseForStudent } from "@/lib/data/courses";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { DataList, DataRowIndex } from "@/components/ui/data-list";
import { formatTime } from "@/lib/video/format-time";

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
  // not a 403, so we don't confirm which course ids exist. Only published
  // lectures come back.
  const course = await getCourseForStudent(parsed.data.courseId, user.id);
  if (!course) notFound();

  const total = course.lectures.length;
  const done = course.lectures.filter((l) => l.completed).length;

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        back={<BackLink href="/dashboard">My courses</BackLink>}
        title={course.title}
        eyebrow={course.professorName ? `Taught by ${course.professorName}` : undefined}
        lead={course.description}
      />

      {/* Sections render only when they have content (CLAUDE.md). */}
      {total > 0 && (
        <Card>
          <div className="mb-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Lectures</CardTitle>
              <span className="text-sm tabular-nums text-muted">
                {done} of {total} complete
              </span>
            </div>
            <ProgressBar value={(done / total) * 100} label="Course progress" />
          </div>
          <DataList>
            {course.lectures.map((lecture, i) => (
              <li key={lecture.id}>
                <Link
                  href={`/courses/${course.id}/lectures/${lecture.id}`}
                  className="-mx-2 flex min-h-14 items-center gap-3 rounded-md px-2 py-3 hover:bg-surface-cream-strong/60 focus-visible:focus-ring"
                >
                  <DataRowIndex>{i + 1}</DataRowIndex>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium text-ink">{lecture.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      {lecture.durationSeconds ? <span>{formatTime(lecture.durationSeconds)}</span> : null}
                      {!lecture.completed && lecture.percentWatched > 0 && (
                        <span className="tabular-nums">{lecture.percentWatched}% watched</span>
                      )}
                    </div>
                  </div>
                  {lecture.completed ? (
                    <Badge tone="success">Completed</Badge>
                  ) : lecture.percentWatched > 0 ? (
                    <Badge tone="neutral">In progress</Badge>
                  ) : (
                    <span className="text-muted-soft" aria-hidden>
                      <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M6 3l5 5-5 5" />
                      </svg>
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </DataList>
        </Card>
      )}
    </div>
  );
}
