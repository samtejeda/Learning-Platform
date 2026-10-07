"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/validation/form";
import type { SubmissionForGrading } from "@/lib/data/exams";
import { TRUE_FALSE_LABELS } from "@/lib/exams/language";
import { Field, TextareaField } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";

type GradingAnswer = SubmissionForGrading["answers"][number];

function optionLabel(a: GradingAnswer, lang: "es" | "en", index: number | null) {
  if (index === null) return "(no answer)";
  if (a.type === "true_false") return TRUE_FALSE_LABELS[lang][index] ?? `#${index}`;
  return a.options?.[index] ?? `Option ${index + 1}`;
}

/**
 * The per-answer comment is controlled so what the professor typed survives a
 * failed save (the server only echoes back flat fields, and React resets
 * uncontrolled fields after a form action).
 */
function CommentField({ answer, errors }: { answer: GradingAnswer; errors?: string[] }) {
  const [value, setValue] = useState(answer.feedback ?? "");
  return (
    <TextareaField
      label="Comment on this answer"
      name={`comment:${answer.questionId}`}
      optional
      rows={2}
      maxLength={2000}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      errors={errors}
    />
  );
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
  const total = submission.answers.length;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {submission.answers.map((a, i) => {
        const isChoice = a.type === "multiple_choice" || a.type === "true_false";
        return (
          <Card key={a.questionId} variant="outlined" className="sm:p-6">
            <p className="mb-1 text-xs font-medium tabular-nums text-muted">
              Question {i + 1} of {total}
            </p>
            <p className="whitespace-pre-line text-base font-medium text-ink">{a.prompt}</p>

            <div className="mt-3 rounded-md bg-surface-soft px-3.5 py-3">
              <p className="text-xs font-medium text-muted">Student&apos;s answer</p>
              <p className={`mt-0.5 whitespace-pre-wrap break-words text-[15px] ${(isChoice ? a.selectedOption !== null : a.answerText) ? "text-ink" : "text-muted"}`}>
                {isChoice ? optionLabel(a, lang, a.selectedOption) : (a.answerText ?? "(no answer)")}
              </p>
            </div>

            {(isChoice || a.referenceAnswer) && (
              <div className="mt-2 rounded-md border border-dashed border-muted-soft px-3.5 py-3">
                <Badge tone="outline">Professor only</Badge>
                {isChoice ? (
                  <p className="mt-2 text-sm text-body">
                    Key: {a.correctOption === null ? "not set" : optionLabel(a, lang, a.correctOption)}
                  </p>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-body">Grading guide: {a.referenceAnswer}</p>
                )}
              </div>
            )}

            <div className="mt-4">
              <CommentField answer={a} errors={state?.fieldErrors?.[`comment:${a.questionId}`]} />
            </div>
          </Card>
        );
      })}

      <Card>
        <CardTitle>Overall grade</CardTitle>
        <p className="mb-4 mt-1 text-sm text-muted">One grade for the whole attempt, 0 to 100. The student sees it with your feedback.</p>
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
          {state?.error && !state.fieldErrors && <Alert tone="error">{state.error}</Alert>}
          {state?.success && <Alert tone="success">{state.success}</Alert>}
          <SubmitButton pendingLabel="Saving…" fullWidth={false} className="min-h-11 w-full sm:w-auto">
            Save grade
          </SubmitButton>
        </div>
      </Card>
    </form>
  );
}
