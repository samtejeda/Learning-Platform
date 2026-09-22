"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/validation/form";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { inputClassName } from "@/components/ui/input";

type Props = {
  /** A server action with the (prev, formData) signature (bind ids first). */
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: { title: string; description: string | null };
  submitLabel: string;
  pendingLabel: string;
};

/**
 * Shared create/edit form. Plain by design (DESIGN.md pass comes later);
 * the frontend pass may restyle freely — the only contract is the field
 * names `title` and `description`, which match `courseFormSchema`.
 */
export function CourseForm({ action, initial, submitLabel, pendingLabel }: Props) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      <Field
        label="Title"
        name="title"
        type="text"
        required
        maxLength={120}
        defaultValue={state?.values?.title ?? initial?.title ?? ""}
        errors={state?.fieldErrors?.title}
      />
      <div>
        <label htmlFor="description" className="block text-sm font-medium text-slate-700 mb-1.5">
          Description <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          maxLength={2000}
          className={inputClassName}
          defaultValue={state?.values?.description ?? initial?.description ?? ""}
          aria-invalid={state?.fieldErrors?.description ? true : undefined}
        />
        {state?.fieldErrors?.description?.[0] && (
          <p className="mt-1.5 text-xs text-red-600">{state.fieldErrors.description[0]}</p>
        )}
      </div>
      <SubmitButton pendingLabel={pendingLabel}>{submitLabel}</SubmitButton>
    </form>
  );
}
