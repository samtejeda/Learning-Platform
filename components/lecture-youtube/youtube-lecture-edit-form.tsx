"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/validation/form";
import { Alert } from "@/components/ui/alert";
import { Field, TextareaField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { YoutubeLectureFields } from "./youtube-lecture-fields";

type Props = {
  /** updateLecture bound to the lecture id (the id is re-checked in the action). */
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial: { title: string; description: string | null; videoId: string | null; durationSeconds: number | null };
};

/**
 * Edit form for a YouTube lecture: title and description like any lecture, plus
 * the link and length (a blank link keeps the current video). The video's source
 * itself can't be changed. Same field names as CourseForm and updateLectureSchema.
 */
export function YoutubeLectureEditForm({ action, initial }: Props) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      <Field
        label="Title"
        name="title"
        type="text"
        required
        maxLength={120}
        defaultValue={state?.values?.title ?? initial.title}
        errors={state?.fieldErrors?.title}
      />
      <TextareaField
        label="Description"
        name="description"
        optional
        rows={5}
        maxLength={2000}
        hint="Shown to students on the lecture page. Up to 2,000 characters."
        defaultValue={state?.values?.description ?? initial.description ?? ""}
        errors={state?.fieldErrors?.description}
      />
      <YoutubeLectureFields
        linkOptional
        initialVideoId={initial.videoId}
        initialSeconds={initial.durationSeconds}
        errors={{ youtubeUrl: state?.fieldErrors?.youtubeUrl, durationSeconds: state?.fieldErrors?.durationSeconds }}
      />
      <Alert tone="info">
        Changing the length changes each student&apos;s percentage watched. Lectures students have already completed stay completed.
      </Alert>
      <SubmitButton pendingLabel="Saving…" className="min-h-11 sm:w-auto">
        Save changes
      </SubmitButton>
    </form>
  );
}
