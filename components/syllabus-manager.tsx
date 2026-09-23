"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { finalizeSyllabusUpload, removeSyllabus, uploadSyllabus } from "@/lib/syllabus/actions";
import { COURSE_FILE_MAX_BYTES, SYLLABUS_MIME_TYPES } from "@/lib/storage/paths";
import { FieldShell, controlAria } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";

type Phase = "idle" | "creating" | "uploading" | "finalizing" | "removing" | "done";

const PHASE_COPY: Record<"creating" | "uploading" | "finalizing", string> = {
  creating: "Preparing the upload…",
  uploading: "Uploading… keep this page open.",
  finalizing: "Verifying the upload…",
};

/**
 * Upload/replace/remove the course's single syllabus PDF. Same three-step
 * flow as LectureUploadForm (server issues a one-time token for a
 * server-chosen, fixed path → the browser uploads directly to Storage →
 * finalize verifies the object) — but with no publish step, since a
 * syllabus is visible to students the moment it's uploaded.
 */
export function SyllabusManager({
  courseId,
  uploadedAt,
}: {
  courseId: string;
  uploadedAt: string | null;
}) {
  const router = useRouter();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setFieldErrors({ file: ["Choose a PDF."] });
      return;
    }
    if (!(SYLLABUS_MIME_TYPES as readonly string[]).includes(file.type)) {
      setFieldErrors({ file: ["Only PDF files are accepted."] });
      return;
    }
    if (file.size > COURSE_FILE_MAX_BYTES) {
      setFieldErrors({ file: ["That file is too large."] });
      return;
    }

    setPhase("creating");
    const ticket = await uploadSyllabus(courseId, { contentType: file.type, sizeBytes: file.size });
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
      setError("The upload failed. Check your connection and try again.");
      return;
    }

    setPhase("finalizing");
    const result = await finalizeSyllabusUpload(courseId);
    if (result?.error) {
      setPhase("idle");
      setError(result.error);
      router.refresh();
      return;
    }
    setPhase("done");
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  async function onRemove() {
    if (!window.confirm("Remove the syllabus? Students will no longer see it.")) return;
    setPhase("removing");
    setError(null);
    const result = await removeSyllabus(courseId);
    setPhase("idle");
    if (result?.error) setError(result.error);
    router.refresh();
  }

  const busy = phase !== "idle" && phase !== "done";
  const uploading = busy && phase !== "removing";
  const fileId = `${id}-file`;

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {phase === "done" && <Alert tone="success">Syllabus uploaded.</Alert>}
      {uploadedAt && (
        <p className="text-sm text-muted">
          Current syllabus uploaded {new Date(uploadedAt).toLocaleDateString()}. Uploading a new PDF replaces
          it.
        </p>
      )}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FieldShell
          label={uploadedAt ? "Replace syllabus" : "Upload syllabus"}
          id={fileId}
          errors={fieldErrors.file}
          hint="PDF only."
        >
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept={SYLLABUS_MIME_TYPES.join(",")}
            required
            disabled={busy}
            className="block w-full rounded-md border border-dashed border-hairline bg-canvas p-2 text-sm text-body file:mr-3 file:rounded-sm file:border-0 file:bg-surface-cream-strong file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink hover:file:bg-hairline focus:focus-ring disabled:opacity-60 aria-[invalid=true]:border-error"
            {...controlAria(fileId, fieldErrors.file, "hint")}
          />
        </FieldShell>

        {uploading && (
          <div className="space-y-2" aria-live="polite">
            <ProgressBar
              value={phase === "finalizing" ? 100 : 0}
              indeterminate={phase !== "finalizing"}
              label="Upload progress"
            />
            <p className="text-sm text-muted">{PHASE_COPY[phase as "creating" | "uploading" | "finalizing"]}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy} aria-busy={uploading} className="sm:w-auto">
            {uploading ? "Working…" : uploadedAt ? "Replace" : "Upload"}
          </Button>
          {uploadedAt && (
            <Button
              type="button"
              variant="ghost"
              className="text-error hover:text-error"
              disabled={busy}
              aria-busy={phase === "removing"}
              onClick={onRemove}
            >
              {phase === "removing" ? "Removing…" : "Remove"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
