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
import { ComprehensionSection } from "@/components/video-player/comprehension-section";
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

  // Locked by an earlier lecture's comprehension question: no player, no stream
  // request, nothing about the video. A plain placeholder until the frontend
  // pass designs the locked state (the server enforces the lock either way).
  if (lecture.locked) {
    const courseHref = `/courses/${lecture.courseId}`;
    const message =
      lecture.lock.cause === "previous_question_blocked"
        ? "You've used both attempts on the previous lecture's question. Contact your teacher to unlock this lecture."
        : lecture.lock.cause === "previous_question_pending"
          ? "Answer the question at the end of the previous lecture to open this one."
          : "This lecture opens after you finish the previous lecture and answer its question.";
    return (
      <div className="space-y-6 sm:space-y-8">
        <PageHeader back={<BackLink href={courseHref}>Back to course</BackLink>} title={lecture.title} />
        <Alert tone="warning">{message}</Alert>
        <Link href={`${courseHref}/lectures/${lecture.lock.afterLectureId}`} className={buttonClassName("secondary", true, "md")}>
          Go to the previous lecture
        </Link>
      </div>
    );
  }

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
        crumbs={
          lecture.tracksProgress
            ? [
                { label: "My courses", href: "/dashboard" },
                { label: courseTitle ?? "Course", href: courseHref },
                { label: "Lectures", href: `${courseHref}#lectures` },
                { label: lecture.title },
              ]
            : [
                { label: "Teaching", href: "/professor" },
                { label: "Course", href: `/professor/courses/${lecture.courseId}` },
                { label: "Lectures", href: `/professor/courses/${lecture.courseId}#lectures` },
                { label: lecture.title },
              ]
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

      <ComprehensionSection lectureId={lecture.id} user={user} tracksProgress={lecture.tracksProgress} />

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
