"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/validation/form";
import { Field, TextareaField } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";

type Initial = {
  titleEs: string | null;
  titleEn: string | null;
  descriptionEs: string | null;
  descriptionEn: string | null;
  maxAttempts: number;
  durationMinutes: number;
  revealKeysAfterAttempts?: boolean;
};

/** Create/edit an exam's bilingual title + description, attempts and time limit.
 * Drafts may leave either language blank; publishing needs both titles. */
export function ExamForm({
  action,
  initial,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: Initial;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  // Controlled so a failed save keeps the box ticked or cleared as the professor left it.
  const [reveal, setReveal] = useState(initial?.revealKeysAfterAttempts ?? false);
  const v = (k: keyof Initial, fallback = "") => state?.values?.[k] ?? (initial?.[k] != null ? String(initial[k]) : fallback);
  const e = (k: string) => state?.fieldErrors?.[k];

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state?.error && !state.fieldErrors && <Alert tone="error">{state.error}</Alert>}
      {state?.success && <Alert tone="success">{state.success}</Alert>}

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-label="Español" className="min-w-0 space-y-4 rounded-lg border border-hairline bg-canvas p-4">
          <Badge tone="outline">Español</Badge>
          <Field label="Title" name="titleEs" maxLength={200} defaultValue={v("titleEs")} errors={e("titleEs")} />
          <TextareaField label="Description" name="descriptionEs" optional rows={3} maxLength={2000} defaultValue={v("descriptionEs")} errors={e("descriptionEs")} />
        </section>
        <section aria-label="English" className="min-w-0 space-y-4 rounded-lg border border-hairline bg-canvas p-4">
          <Badge tone="outline">English</Badge>
          <Field label="Title" name="titleEn" maxLength={200} defaultValue={v("titleEn")} errors={e("titleEn")} />
          <TextareaField label="Description" name="descriptionEn" optional rows={3} maxLength={2000} defaultValue={v("descriptionEn")} errors={e("descriptionEn")} />
        </section>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Attempts allowed"
          name="maxAttempts"
          type="number"
          inputMode="numeric"
          min={1}
          max={10}
          hint="How many times each student can take this exam."
          defaultValue={v("maxAttempts", "2")}
          errors={e("maxAttempts")}
        />
        <Field
          label="Time limit (minutes)"
          name="durationMinutes"
          type="number"
          inputMode="numeric"
          min={1}
          max={480}
          hint="The clock starts when the student begins an attempt."
          defaultValue={v("durationMinutes", "20")}
          errors={e("durationMinutes")}
        />
      </div>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
        <input
          type="checkbox"
          name="revealKeysAfterAttempts"
          checked={reveal}
          onChange={(ev) => setReveal(ev.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-primary focus-visible:focus-ring"
        />
        <span>
          Show the correct answers once a student has used all their attempts
          <span className="block text-xs text-muted">Until then students only see which answers were right or wrong.</span>
        </span>
      </label>

      <SubmitButton pendingLabel="Saving…" fullWidth={false} className="min-h-11 w-full sm:w-auto">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
