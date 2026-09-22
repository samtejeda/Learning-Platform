"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createLecture, finalizeLectureUpload, retryLectureUpload, type UploadTicket } from "@/lib/lectures/actions";
import { LECTURE_MAX_BYTES, LECTURE_MIME_TYPES } from "@/lib/storage/paths";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClassName } from "@/components/ui/input";

type Phase = "idle" | "creating" | "uploading" | "finalizing" | "done";

/**
 * Three-step upload: createLecture (server issues a one-time signed token
 * for a server-chosen path) → the browser uploads straight to Storage →
 * finalizeLectureUpload (server verifies the object, records duration).
 * Nothing about the path or bucket is chosen here; the server decides.
 * Plain by design; the frontend pass may restyle freely.
 */
export function LectureUploadForm({ courseId, retryLectureId }: { courseId: string; retryLectureId?: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [progress, setProgress] = useState(0);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setFieldErrors({ file: ["Choose a video file."] });
      return;
    }
    if (!(LECTURE_MIME_TYPES as readonly string[]).includes(file.type)) {
      setFieldErrors({ file: ["Only MP4, WebM, or MOV video files are accepted."] });
      return;
    }
    if (file.size > LECTURE_MAX_BYTES) {
      setFieldErrors({ file: ["That file is too large."] });
      return;
    }

    setPhase("creating");
    const ticket: UploadTicket = retryLectureId
      ? await retryLectureUpload(retryLectureId)
      : await createLecture(courseId, {
          title: String(fd.get("title") ?? ""),
          description: String(fd.get("description") ?? ""),
          contentType: file.type,
          sizeBytes: file.size,
        });
    if (!ticket.ok) {
      setPhase("idle");
      setError(ticket.error);
      setFieldErrors(ticket.fieldErrors ?? {});
      return;
    }

    setPhase("uploading");
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from(ticket.bucket)
      .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type, upsert: true });
    if (uploadError) {
      setPhase("idle");
      setError("The upload failed. Check your connection and try again — the lecture is saved as 'Upload pending'.");
      router.refresh();
      return;
    }
    setProgress(100);

    setPhase("finalizing");
    const durationSeconds = await readDuration(file);
    const result = await finalizeLectureUpload(ticket.lectureId, { durationSeconds });
    if (result?.error) {
      setPhase("idle");
      setError(result.error);
      router.refresh();
      return;
    }
    setPhase("done");
    formEl.reset();
    router.refresh();
  }

  const busy = phase !== "idle" && phase !== "done";

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      {phase === "done" && <Alert tone="success">Video uploaded. Publish it when you&apos;re ready.</Alert>}
      {!retryLectureId && (
        <>
          <Field label="Title" name="title" type="text" required maxLength={120} errors={fieldErrors.title} disabled={busy} />
          <div>
            <label htmlFor="lecture-description" className="block text-sm font-medium text-slate-700 mb-1.5">
              Description <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea id="lecture-description" name="description" rows={3} maxLength={2000} className={inputClassName} disabled={busy} />
          </div>
        </>
      )}
      <div>
        <label htmlFor="lecture-file" className="block text-sm font-medium text-slate-700 mb-1.5">
          Video file <span className="text-slate-400 font-normal">(MP4, WebM, or MOV)</span>
        </label>
        <input
          id="lecture-file"
          ref={fileRef}
          type="file"
          accept={LECTURE_MIME_TYPES.join(",")}
          className="block w-full text-sm text-slate-700"
          disabled={busy}
          required
        />
        {fieldErrors.file?.[0] && <p className="mt-1.5 text-xs text-red-600">{fieldErrors.file[0]}</p>}
      </div>
      {busy && (
        <p className="text-sm text-slate-500" aria-live="polite">
          {phase === "creating" && "Preparing upload…"}
          {phase === "uploading" && `Uploading… ${progress ? `${progress}%` : "this can take a while for large files."}`}
          {phase === "finalizing" && "Verifying upload…"}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {retryLectureId ? "Retry upload" : "Add lecture"}
      </Button>
    </form>
  );
}

/** Read the media duration from the file locally (professor's own browser). */
function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    const done = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(value) && value > 0 ? value : 0);
    };
    video.onloadedmetadata = () => done(video.duration);
    video.onerror = () => done(0);
    video.src = url;
  });
}
