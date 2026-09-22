"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  createLecture,
  finalizeLectureUpload,
  retryLectureUpload,
  type UploadTicket,
} from "@/lib/lectures/actions";
import { LECTURE_MAX_BYTES, LECTURE_MIME_TYPES } from "@/lib/storage/paths";
import { Field, FieldShell, TextareaField, controlAria } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";

type Phase = "idle" | "creating" | "uploading" | "finalizing" | "done";

const PHASE_COPY: Record<Exclude<Phase, "idle" | "done">, string> = {
  creating: "Preparing the upload…",
  uploading: "Uploading… keep this page open. Large files can take a while.",
  finalizing: "Verifying the upload…",
};

/**
 * Three-step upload: createLecture (server issues a one-time signed token
 * for a server-chosen path) → the browser uploads straight to Storage →
 * finalizeLectureUpload (server verifies the object, records duration).
 * Nothing about the path or bucket is chosen here; the server decides.
 */
export function LectureUploadForm({ courseId, retryLectureId }: { courseId: string; retryLectureId?: string }) {
  const router = useRouter();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [fileName, setFileName] = useState<string | null>(null);

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
      setError(
        "The upload failed. Check your connection and try again — the lecture is saved as “Upload pending”.",
      );
      router.refresh();
      return;
    }

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
    setFileName(null);
    router.refresh();
  }

  const busy = phase !== "idle" && phase !== "done";
  const fileId = `${id}-file`;
  const fileError = fieldErrors.file;

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      {phase === "done" && <Alert tone="success">Video uploaded. Publish it when you&apos;re ready.</Alert>}

      {!retryLectureId && (
        <>
          <Field
            label="Title"
            name="title"
            type="text"
            required
            maxLength={120}
            placeholder="e.g. Lecture 1 — Overview"
            errors={fieldErrors.title}
            disabled={busy}
          />
          <TextareaField
            label="Description"
            name="description"
            optional
            rows={3}
            maxLength={2000}
            errors={fieldErrors.description}
            disabled={busy}
          />
        </>
      )}

      <FieldShell
        label="Video file"
        id={fileId}
        errors={fileError}
        hint="MP4, WebM, or MOV. The bucket cap is 2 GB; check your project's plan for the per-file limit."
      >
        <input
          ref={fileRef}
          type="file"
          name="file"
          accept={LECTURE_MIME_TYPES.join(",")}
          required
          disabled={busy}
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          className="block w-full rounded-md border border-dashed border-hairline bg-canvas p-2 text-sm text-body file:mr-3 file:rounded-sm file:border-0 file:bg-surface-cream-strong file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink hover:file:bg-hairline focus:focus-ring disabled:opacity-60 aria-[invalid=true]:border-error"
          {...controlAria(fileId, fileError, "hint")}
        />
      </FieldShell>

      {busy && (
        <div className="space-y-2" aria-live="polite">
          <ProgressBar value={phase === "finalizing" ? 100 : 0} indeterminate={phase !== "finalizing"} label="Upload progress" />
          <p className="text-sm text-muted">
            {PHASE_COPY[phase as Exclude<Phase, "idle" | "done">]}
            {fileName ? ` (${fileName})` : ""}
          </p>
        </div>
      )}

      <Button type="submit" disabled={busy} aria-busy={busy} fullWidth className="sm:w-auto">
        {busy ? "Working…" : retryLectureId ? "Upload video" : "Add lecture"}
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
