import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getLectureForViewer } from "@/lib/data/progress";
import { LecturePlayer } from "@/components/video-player/lecture-player";

const paramsSchema = z.object({ courseId: z.uuid(), lectureId: z.uuid() });

export default async function LecturePage({
  params,
}: {
  params: Promise<{ courseId: string; lectureId: string }>;
}) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const user = await requireUser();
  // Enrollment + publication (or course ownership for a professor preview)
  // are enforced inside the query. Anything else is a 404.
  const lecture = await getLectureForViewer(parsed.data.lectureId, user);
  if (!lecture || lecture.courseId !== parsed.data.courseId) notFound();

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/courses/${lecture.courseId}`} className="text-sm text-slate-500 hover:text-slate-900">
          ← Back to course
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900 mt-2">{lecture.title}</h1>
        {!lecture.tracksProgress && (
          <p className="text-xs text-slate-500 mt-1">Preview — progress isn&apos;t recorded for instructors.</p>
        )}
      </div>

      <LecturePlayer
        lectureId={lecture.id}
        durationSeconds={lecture.durationSeconds}
        tracksProgress={lecture.tracksProgress}
        initialProgress={lecture.progress}
      />

      {lecture.description && (
        <p className="text-slate-700 whitespace-pre-line">{lecture.description}</p>
      )}
    </div>
  );
}
