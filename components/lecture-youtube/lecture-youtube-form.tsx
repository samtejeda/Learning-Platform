"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createYoutubeLecture } from "@/lib/lectures/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, TextareaField } from "@/components/ui/field";
import { YoutubeLectureFields } from "./youtube-lecture-fields";

/**
 * Add a lecture whose video is a YouTube link: title, description, link and
 * length. createYoutubeLecture stores only the video id (the server never
 * fetches the link) and makes a draft, to publish later like any lecture.
 * The server's messages are shown as written, and a failed submit keeps what
 * was typed.
 */
export function LectureYoutubeForm({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [added, setAdded] = useState(false);
  // Bumped after a success so every field (including the link and preview) starts empty.
  const [formKey, setFormKey] = useState(0);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setAdded(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createYoutubeLecture(courseId, {
        title: String(fd.get("title") ?? ""),
        description: String(fd.get("description") ?? ""),
        youtubeUrl: String(fd.get("youtubeUrl") ?? ""),
        durationSeconds: String(fd.get("durationSeconds") ?? ""),
      });
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setAdded(true);
      setFormKey((n) => n + 1);
      router.refresh();
    });
  }

  return (
    <form key={formKey} onSubmit={onSubmit} className="space-y-5" noValidate>
      <Alert tone="info">
        Anyone with a YouTube link can watch that video outside this site, so don&apos;t use YouTube for content that must stay
        enrolled-only. Progress tracking is also less strict than for uploaded videos.
      </Alert>
      {error && <Alert tone="error">{error}</Alert>}
      {added && <Alert tone="success">Lecture added as a draft. Publish it when you&apos;re ready.</Alert>}

      <Field
        label="Title"
        name="title"
        type="text"
        required
        maxLength={120}
        placeholder="e.g. Lecture 1 — Overview"
        errors={fieldErrors.title}
        disabled={pending}
      />
      <TextareaField
        label="Description"
        name="description"
        optional
        rows={3}
        maxLength={2000}
        errors={fieldErrors.description}
        disabled={pending}
      />
      <YoutubeLectureFields
        errors={{ youtubeUrl: fieldErrors.youtubeUrl, durationSeconds: fieldErrors.durationSeconds }}
        disabled={pending}
      />

      <Button type="submit" disabled={pending} aria-busy={pending} fullWidth className="min-h-11 sm:w-auto">
        {pending ? "Adding…" : "Add lecture"}
      </Button>
    </form>
  );
}
