import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getCourseForStudent } from "@/lib/data/courses";
import { getLectureForViewer } from "@/lib/data/progress";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { VideoPlayer } from "@/components/video-player/video-player";

const paramsSchema = z.object({ courseId: z.uuid(), lectureId: z.uuid() });

export default async function LecturePage({
  params,
}: {
  params: Promise<{ courseId: string; lectureId: string }>;
}) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const user = await requireUser();
  // Enrollment + publication (or course ownership for an instructor preview)
  // are enforced inside the query. Anything else is a 404.
  const lecture = await getLectureForViewer(parsed.data.lectureId, user);
  if (!lecture || lecture.courseId !== parsed.data.courseId) notFound();

  // Sibling navigation comes from the student's own published list, so a
  // draft can never appear as "next". Instructor previews skip it.
  let prev: { id: string; title: string } | null = null;
  let next: { id: string; title: string } | null = null;
  let courseTitle: string | null = null;
  if (lecture.tracksProgress) {
    const course = await getCourseForStudent(lecture.courseId, user.id);
    if (course) {
      courseTitle = course.title;
      const i = course.lectures.findIndex((l) => l.id === lecture.id);
      if (i > 0) prev = course.lectures[i - 1];
      if (i >= 0 && i < course.lectures.length - 1) next = course.lectures[i + 1];
    }
  }

  const courseHref = `/courses/${lecture.courseId}`;
  const lectureHref = (id: string) => `${courseHref}/lectures/${id}`;

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        back={
          <BackLink href={lecture.tracksProgress ? courseHref : `/professor/courses/${lecture.courseId}`}>
            {courseTitle ?? "Back to course"}
          </BackLink>
        }
        title={lecture.title}
      />

      {!lecture.tracksProgress && (
        <Alert tone="info">Preview — progress isn&apos;t recorded for instructors.</Alert>
      )}

      <VideoPlayer
        // Remount per lecture so no playback state leaks between lectures.
        key={lecture.id}
        lectureId={lecture.id}
        title={lecture.title}
        durationSeconds={lecture.durationSeconds}
        tracksProgress={lecture.tracksProgress}
        initialProgress={lecture.progress}
        next={next ? { href: lectureHref(next.id), title: next.title } : null}
      />

      {lecture.description && (
        <Card variant="outlined">
          <p className="whitespace-pre-line text-[15px] text-body-strong">{lecture.description}</p>
        </Card>
      )}

      {(prev || next) && (
        <nav aria-label="Lecture navigation" className="grid gap-3 sm:grid-cols-2">
          {prev ? (
            <Link href={lectureHref(prev.id)} className={buttonClassName("secondary", true, "md", "justify-start")}>
              <span aria-hidden>←</span>
              <span className="truncate">Previous: {prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={lectureHref(next.id)} className={buttonClassName("secondary", true, "md", "justify-end")}>
              <span className="truncate">Next: {next.title}</span>
              <span aria-hidden>→</span>
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
