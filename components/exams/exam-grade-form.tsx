"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/validation/form";
import type { SubmissionForGrading } from "@/lib/data/exams";
import { TRUE_FALSE_LABELS } from "@/lib/exams/language";
import { Field, TextareaField } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";

function selectedLabel(a: SubmissionForGrading["answers"][number], lang: "es" | "en", index: number | null) {
  if (index === null) return "(no answer)";
  if (a.type === "true_false") return TRUE_FALSE_LABELS[lang][index] ?? `#${index}`;
  return a.options?.[index] ?? `Option ${index + 1}`;
}

/** Manual grading: one overall grade (0–100) + feedback, and an optional comment per answer. */
export function ExamGradeForm({
  action,
  submission,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submission: SubmissionForGrading;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const lang = submission.language;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      {state?.success && <Alert tone="success">{state.success}</Alert>}

      {submission.answers.map((a, i) => (
        <Card key={a.questionId}>
          <p className="text-sm font-medium">
            {i + 1}. {a.prompt}
          </p>
          <div className="mt-3 space-y-1 text-sm">
            {a.type === "multiple_choice" || a.type === "true_false" ? (
              <>
                <p>
                  <span className="text-muted">Student chose: </span>
                  {selectedLabel(a, lang, a.selectedOption)}
                </p>
                <p className="text-muted">
                  Key: {a.correctOption === null ? "not set" : selectedLabel(a, lang, a.correctOption)}
                </p>
              </>
            ) : (
              <>
                <p className="whitespace-pre-wrap">
                  <span className="text-muted">Answer: </span>
                  {a.answerText ?? "(no answer)"}
                </p>
                {a.referenceAnswer && <p className="whitespace-pre-wrap text-muted">Grading guide: {a.referenceAnswer}</p>}
              </>
            )}
          </div>
          <div className="mt-3">
            <TextareaField
              label="Comment on this answer"
              name={`comment:${a.questionId}`}
              optional
              rows={2}
              maxLength={2000}
              defaultValue={a.feedback ?? ""}
            />
          </div>
        </Card>
      ))}

      <Card>
        <div className="space-y-4">
          <Field
            label="Grade (0–100)"
            name="grade"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="any"
            defaultValue={state?.values?.grade ?? (submission.grade !== null ? String(submission.grade) : "")}
            errors={state?.fieldErrors?.grade}
          />
          <TextareaField
            label="Feedback for the student"
            name="feedback"
            optional
            rows={4}
            maxLength={5000}
            defaultValue={state?.values?.feedback ?? submission.feedback ?? ""}
            errors={state?.fieldErrors?.feedback}
          />
          <SubmitButton pendingLabel="Saving…" fullWidth={false}>
            Save grade
          </SubmitButton>
        </div>
      </Card>
    </form>
  );
}
