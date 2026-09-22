"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/validation/form";
import { Field, TextareaField } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";

type Props = {
  /** A server action with the (prev, formData) signature (bind ids first). */
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: { title: string; description: string | null };
  submitLabel: string;
  pendingLabel: string;
};

/**
 * Shared create/edit form. Field names `title` and `description` match
 * `courseFormSchema` (lib/validation/courses.ts). Values are kept on a failed
 * submit via `state.values`.
 */
export function CourseForm({ action, initial, submitLabel, pendingLabel }: Props) {
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
        placeholder="e.g. Introduction to the Course"
        defaultValue={state?.values?.title ?? initial?.title ?? ""}
        errors={state?.fieldErrors?.title}
      />
      <TextareaField
        label="Description"
        name="description"
        optional
        rows={5}
        maxLength={2000}
        hint="Shown to students on the course page. Up to 2,000 characters."
        defaultValue={state?.values?.description ?? initial?.description ?? ""}
        errors={state?.fieldErrors?.description}
      />
      <SubmitButton pendingLabel={pendingLabel} className="sm:w-auto">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
