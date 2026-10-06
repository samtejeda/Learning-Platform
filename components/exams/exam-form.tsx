"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/validation/form";
import { Field, TextareaField } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";

type Initial = {
  titleEs: string | null;
  titleEn: string | null;
  descriptionEs: string | null;
  descriptionEn: string | null;
  maxAttempts: number;
  durationMinutes: number;
};

/** Create/edit an exam's bilingual title + description, attempts and time limit.
 * Drafts may leave either language blank; publish requires both titles. */
export function ExamForm({
  action,
  initial,
  submitLabel,
  disabled,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: Initial;
  submitLabel: string;
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const v = (k: keyof Initial, fallback = "") => state?.values?.[k] ?? (initial?.[k] != null ? String(initial[k]) : fallback);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      {state?.success && <Alert tone="success">{state.success}</Alert>}
      <fieldset disabled={disabled} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title (Español)" name="titleEs" maxLength={200} defaultValue={v("titleEs")} errors={state?.fieldErrors?.titleEs} />
          <Field label="Title (English)" name="titleEn" maxLength={200} defaultValue={v("titleEn")} errors={state?.fieldErrors?.titleEn} />
          <TextareaField label="Description (Español)" name="descriptionEs" optional rows={3} maxLength={2000} defaultValue={v("descriptionEs")} errors={state?.fieldErrors?.descriptionEs} />
          <TextareaField label="Description (English)" name="descriptionEn" optional rows={3} maxLength={2000} defaultValue={v("descriptionEn")} errors={state?.fieldErrors?.descriptionEn} />
          <Field label="Attempts allowed" name="maxAttempts" type="number" inputMode="numeric" min={1} max={10} defaultValue={v("maxAttempts", "2")} errors={state?.fieldErrors?.maxAttempts} />
          <Field label="Time limit (minutes)" name="durationMinutes" type="number" inputMode="numeric" min={1} max={480} defaultValue={v("durationMinutes", "20")} errors={state?.fieldErrors?.durationMinutes} />
        </div>
        <SubmitButton pendingLabel="Saving…" fullWidth={false}>
          {submitLabel}
        </SubmitButton>
      </fieldset>
    </form>
  );
}
