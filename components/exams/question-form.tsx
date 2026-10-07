"use client";

import { useActionState, useRef, useState } from "react";
import type { ActionState } from "@/lib/validation/form";
import type { ProfessorQuestion } from "@/lib/data/exams";
import { BLANK_TOKEN } from "@/lib/exams/blanks";
import { TRUE_FALSE_LABELS } from "@/lib/exams/language";
import { Field, SelectField, TextareaField } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";

export const QUESTION_TYPE_LABELS: Record<ProfessorQuestion["type"], string> = {
  multiple_choice: "Multiple choice",
  true_false: "True / false",
  fill_in_the_blank: "Fill in the blank",
  short_essay: "Short essay",
};

/**
 * Create (type picker) or edit (type fixed) a question. Both languages side
 * by side; every field is optional while drafting. The key is stored by
 * position, so it is entered once and applies to both languages.
 */
export function QuestionForm({
  action,
  question,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  /** Present when editing; absent when creating. */
  question?: ProfessorQuestion;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const [type, setType] = useState<ProfessorQuestion["type"]>(question?.type ?? "multiple_choice");
  const formRef = useRef<HTMLFormElement>(null);
  /** Put the fixed blank token at the cursor of a prompt field (never typed by hand). */
  function insertBlank(name: "promptEs" | "promptEn") {
    const el = formRef.current?.elements.namedItem(name);
    if (!(el instanceof HTMLTextAreaElement)) return;
    el.setRangeText(BLANK_TOKEN, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, "end");
    el.focus();
  }
  const val = (k: string, fallback: string) => state?.values?.[k] ?? fallback;
  const err = (k: string) => state?.fieldErrors?.[k];

  return (
    <form ref={formRef} action={formAction} className="space-y-4" noValidate>
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      {state?.success && <Alert tone="success">{state.success}</Alert>}

      {question ? (
        <p className="text-sm text-muted">{QUESTION_TYPE_LABELS[question.type]}</p>
      ) : (
        <SelectField label="Question type" name="type" value={type} onChange={(e) => setType(e.target.value as typeof type)} errors={err("type")}>
          {Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextareaField label="Prompt (Español)" name="promptEs" rows={3} maxLength={2000} defaultValue={val("promptEs", question?.promptEs ?? "")} errors={err("promptEs")} />
        <TextareaField label="Prompt (English)" name="promptEn" rows={3} maxLength={2000} defaultValue={val("promptEn", question?.promptEn ?? "")} errors={err("promptEn")} />
      </div>

      {type === "multiple_choice" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextareaField label="Options (Español)" name="optionsEs" rows={4} hint="One option per line, 2–6. Same count and order as English." defaultValue={val("optionsEs", question?.optionsEs?.join("\n") ?? "")} errors={err("optionsEs")} />
            <TextareaField label="Options (English)" name="optionsEn" rows={4} hint="One option per line, 2–6." defaultValue={val("optionsEn", question?.optionsEn?.join("\n") ?? "")} errors={err("optionsEn")} />
          </div>
          <SelectField label="Correct answer (scored automatically)" name="correctOption" defaultValue={val("correctOption", question?.correctOption != null ? String(question.correctOption) : "")} errors={err("correctOption")}>
            <option value="" disabled>Choose…</option>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <option key={i} value={i}>
                Option {i + 1}
              </option>
            ))}
          </SelectField>
        </>
      )}

      {type === "true_false" && (
        <SelectField label="Correct answer (scored automatically)" name="correctOption" defaultValue={val("correctOption", question?.correctOption != null ? String(question.correctOption) : "")} errors={err("correctOption")}>
          <option value="" disabled>Choose…</option>
          <option value="0">{TRUE_FALSE_LABELS.en[0]} / {TRUE_FALSE_LABELS.es[0]}</option>
          <option value="1">{TRUE_FALSE_LABELS.en[1]} / {TRUE_FALSE_LABELS.es[1]}</option>
        </SelectField>
      )}

      {type === "fill_in_the_blank" && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => insertBlank("promptEs")}>Insert blank (Español)</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => insertBlank("promptEn")}>Insert blank (English)</Button>
          <p className="w-full text-xs text-muted">Both languages need the same number of blanks. Each blank is scored by you, not automatically.</p>
        </div>
      )}

      <Field label="Points" name="points" type="number" inputMode="numeric" min={1} max={100} defaultValue={val("points", String(question?.points ?? 1))} errors={err("points")} />

      {(type === "fill_in_the_blank" || type === "short_essay") && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextareaField label="Grading guide (Español)" name="referenceAnswerEs" optional rows={3} hint="Only you see this. Never shown to students." defaultValue={val("referenceAnswerEs", question?.referenceAnswerEs ?? "")} errors={err("referenceAnswerEs")} />
          <TextareaField label="Grading guide (English)" name="referenceAnswerEn" optional rows={3} hint="Only you see this. Never shown to students." defaultValue={val("referenceAnswerEn", question?.referenceAnswerEn ?? "")} errors={err("referenceAnswerEn")} />
        </div>
      )}

      <SubmitButton pendingLabel="Saving…" fullWidth={false}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}



