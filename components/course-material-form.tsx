"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createMaterial, finalizeMaterialUpload, retryMaterialUpload } from "@/lib/course-materials/actions";
import { COURSE_FILE_MAX_BYTES, COURSE_FILE_MIME_TYPES } from "@/lib/storage/paths";
import { Field, FieldShell, SelectField, TextareaField, controlAria } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";

type Phase = "idle" | "creating" | "uploading" | "finalizing" | "done";
type Kind = "file" | "link";

const PHASE_COPY: Record<Exclude<Phase, "idle" | "done">, string> = {
  creating: "Preparing…",
  uploading: "Uploading… keep this page open. Large files can take a while.",
  finalizing: "Verifying the upload…",
};

/**
 * Add a course material: a kind toggle switches between "Upload a file"
 * (three-step flow identical to LectureUploadForm) and "Add a link" (a
 * single createMaterial call — no upload/finalize step). Also used, via
 * retryMaterialId, to retry a file-kind upload that never completed.
 */
export function CourseMaterialForm({
  courseId,
  retryMaterialId,
}: {
  courseId: string;
  retryMaterialId?: string;
}) {
  const router = useRouter();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Kind>("file");
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
    const title = String(fd.get("title") ?? "");
    const description = String(fd.get("description") ?? "");

    if (!retryMaterialId && kind === "link") {
      setPhase("creating");
      const result = await createMaterial(courseId, { kind: "link", title, description, url: String(fd.get("url") ?? "") });
      if (!result.ok) {
        setPhase("idle");
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setPhase("done");
      formEl.reset();
      router.refresh();
      return;
    }

    const file = fileRef.current?.files?.[0];
    if (!file) {
      setFieldErrors({ file: ["Choose a file."] });
      return;
    }
    if (!(COURSE_FILE_MIME_TYPES as readonly string[]).includes(file.type)) {
      setFieldErrors({ file: ["That file type isn't supported."] });
      return;
    }
    if (file.size > COURSE_FILE_MAX_BYTES) {
      setFieldErrors({ file: ["That file is too large."] });
      return;
    }

    setPhase("creating");
    const ticket = retryMaterialId
      ? await retryMaterialUpload(retryMaterialId)
      : await createMaterial(courseId, {
          kind: "file",
          title,
          description,
          contentType: file.type,
          sizeBytes: file.size,
        });
    if (!ticket.ok) {
      setPhase("idle");
      setError(ticket.error);
      setFieldErrors(ticket.fieldErrors ?? {});
      return;
    }
    if (ticket.kind !== "file") {
      // Not reachable in practice (this branch only ever creates/retries
      // file-kind tickets), but keeps the union exhaustive without a cast.
      setPhase("idle");
      setError("Something went wrong. Please try again.");
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
        "The upload failed. Check your connection and try again — the material is saved as “Upload pending”.",
      );
      router.refresh();
      return;
    }

    setPhase("finalizing");
    const result = await finalizeMaterialUpload(ticket.materialId, {});
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
  const urlId = `${id}-url`;
  const kindId = `${id}-kind`;
  const fileError = fieldErrors.file;

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      {phase === "done" && <Alert tone="success">Saved.</Alert>}

      {!retryMaterialId && (
        <>
          <SelectField
            label="Type"
            name="kind"
            id={kindId}
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            disabled={busy}
          >
            <option value="file">Upload a file</option>
            <option value="link">Add a link</option>
          </SelectField>
          <Field
            label="Title"
            name="title"
            type="text"
            required
            maxLength={120}
            placeholder="e.g. Week 1 handout"
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

      {(retryMaterialId || kind === "file") && (
        <FieldShell
          label="File"
          id={fileId}
          errors={fileError}
          hint="PDF, image, video, or Word/PowerPoint document. Up to 2 GB (check your project's plan for the per-file limit)."
        >
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept={COURSE_FILE_MIME_TYPES.join(",")}
            required
            disabled={busy}
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            className="block w-full rounded-md border border-dashed border-hairline bg-canvas p-2 text-sm text-body file:mr-3 file:rounded-sm file:border-0 file:bg-surface-cream-strong file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink hover:file:bg-hairline focus:focus-ring disabled:opacity-60 aria-[invalid=true]:border-error"
            {...controlAria(fileId, fileError, "hint")}
          />
        </FieldShell>
      )}

      {!retryMaterialId && kind === "link" && (
        <Field
          label="URL"
          name="url"
          type="url"
          id={urlId}
          required
          placeholder="https://…"
          errors={fieldErrors.url}
          disabled={busy}
        />
      )}

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
        {busy ? "Working…" : retryMaterialId ? "Upload file" : "Add material"}
      </Button>
    </form>
  );
}
