import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getCourseForStudent } from "@/lib/data/courses";
import { StudentExamList } from "@/components/exams/student-exam-list";
import { listExamsForStudent } from "@/lib/data/exam-attempts";
import { DEFAULT_CONTENT_LANGUAGE } from "@/lib/exams/language";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { DataList, DataRowIndex } from "@/components/ui/data-list";
import { formatTime } from "@/lib/video/format-time";
import { SyllabusViewer } from "@/components/syllabus-viewer";
import { CourseMaterialsList } from "@/components/course-materials-list";
import { CourseFrame } from "@/components/course/course-frame";
import { CourseSection } from "@/components/course/course-section";
import { sectionsFor, type SectionId } from "@/components/course/sections";

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

  // Enrollment already verified above; the query re-checks it and the published filter.
  const examList = await listExamsForStudent(course.id, user.id, DEFAULT_CONTENT_LANGUAGE);
  const total = course.lectures.length;
  const done = course.lectures.filter((l) => l.completed).length;
  const inProgress = examList.filter((e) => e.openAttemptId !== null).length;
  const hasAnyContent = total > 0 || course.hasSyllabus || course.materials.length > 0 || examList.length > 0;

  // A section appears only when it has content (CLAUDE.md). The ORDER comes
  // from the shared section list, the same one the chips and sidebar read.
  const sections = sectionsFor("student", {
    syllabus: course.hasSyllabus,
    lectures: total > 0,
    materials: course.materials.length > 0,
    exams: examList.length > 0,
  });

  const body: Partial<Record<SectionId, { status: string; node: React.ReactNode }>> = {
    syllabus: {
      status: "PDF available",
      node: <SyllabusViewer courseId={course.id} />,
    },
    lectures: {
      status: `${done} of ${total} completed`,
      node: (
        <>
          <div className="mb-3">
            <ProgressBar value={total > 0 ? (done / total) * 100 : 0} label="Course progress" />
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
        </>
      ),
    },
    materials: {
      status: `${course.materials.length} ${course.materials.length === 1 ? "item" : "items"}`,
      node: <CourseMaterialsList materials={course.materials} />,
    },
    exams: {
      status: `${examList.length} ${examList.length === 1 ? "exam" : "exams"}${inProgress > 0 ? ` · ${inProgress} in progress` : ""}`,
      node: <StudentExamList courseId={course.id} exams={examList} />,
    },
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        back={<BackLink href="/dashboard">My courses</BackLink>}
        crumbs={[{ label: "My courses", href: "/dashboard" }, { label: course.title }]}
        title={course.title}
        eyebrow={course.professorName ? `Taught by ${course.professorName}` : undefined}
        lead={course.description}
      />

      {/* When the course has no content at all, say so instead of showing a blank page. */}
      {!hasAnyContent && (
        <EmptyState
          title="Nothing here yet."
          description="Your professor hasn't published anything for this course yet. Check back soon."
        />
      )}

      <CourseFrame sections={sections}>
        {sections.map((s) => {
          const b = body[s.id];
          return b ? (
            <CourseSection key={s.id} id={s.id} courseId={course.id} view="student" status={b.status}>
              {b.node}
            </CourseSection>
          ) : null;
        })}
      </CourseFrame>
    </div>
  );
}
