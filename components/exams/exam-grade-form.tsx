"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/validation/form";
import type { SubmissionForGrading } from "@/lib/data/exams";
import { TRUE_FALSE_LABELS } from "@/lib/exams/language";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TextareaField } from "@/components/ui/field";
import { BlankPrompt } from "./blank-prompt";
import { checkPoints, runningTotal } from "./points-input";
import { QuestionOutcome } from "./question-outcome";
import { CheckIcon, ClockIcon } from "./status-icons";

type GradingAnswer = SubmissionForGrading["answers"][number];
const pts = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;

function optionLabel(a: GradingAnswer, lang: "es" | "en", index: number | null) {
  if (index === null) return "(no answer)";
  if (a.type === "true_false") return TRUE_FALSE_LABELS[lang][index] ?? `#${index}`;
  return a.options?.[index] ?? `Option ${index + 1}`;
}

/**
 * Manual grading. Multiple choice and true/false show their automatic result
 * and the key (professor only). Fill in the blank and essay get a points box
 * with the maximum shown; a running total updates as you type. Every value is
 * controlled, so a refused save keeps everything you entered.
 */
export function ExamGradeForm({
  action,
  submission,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submission: SubmissionForGrading;
}) {
  const [state, formAction, saving] = useActionState<ActionState, FormData>(action, null);
  const lang = submission.language;
  const total = submission.answers.length;
  const manual = submission.answers.filter((a) => a.type !== "multiple_choice" && a.type !== "true_false" && a.state !== "unanswered");
  const autoPoints = submission.answers
    .filter((a) => a.type === "multiple_choice" || a.type === "true_false")
    .reduce((sum, a) => sum + a.pointsEarned, 0);

  const [points, setPoints] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      manual.map((a) => [a.questionId, state?.values?.[`points:${a.questionId}`] ?? (a.pointsAwarded !== null ? String(a.pointsAwarded) : "")]),
    ),
  );
  const [comments, setComments] = useState<Record<string, string>>(() =>
    Object.fromEntries(submission.answers.map((a) => [a.questionId, a.feedback ?? ""])),
  );
  const [feedback, setFeedback] = useState(submission.feedback ?? "");
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const checks = manual.map((a) => checkPoints(points[a.questionId] ?? "", a.points));
  const running = runningTotal(autoPoints, checks);
  const maxTotal = submission.score.totalMax;
  const incomplete = manual.filter((_, i) => checks[i].value === null);
  const invalid = manual.filter((_, i) => checks[i].error !== null);
  const final = running.missing === 0;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {submission.answers.map((a, i) => {
        const isChoice = a.type === "multiple_choice" || a.type === "true_false";
        const isManual = !isChoice && a.state !== "unanswered";
        const idx = manual.findIndex((m) => m.questionId === a.questionId);
        const check = idx >= 0 ? checks[idx] : null;
        const showError = !!check?.error && (touched[a.questionId] || !!state?.error);
        const hasBlanks = a.type === "fill_in_the_blank" && a.blanks !== null;
        return (
          <Card key={a.questionId} id={`answer-${i + 1}`} variant="outlined" className="scroll-mt-20 space-y-3 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium tabular-nums text-muted">
                Question {i + 1} of {total} · {pts(a.points)}
              </p>
              <Badge tone="outline">{isChoice ? "Scored automatically" : "You grade this"}</Badge>
            </div>

            {hasBlanks ? (
              <BlankPrompt prompt={a.prompt} answers={a.blanks} />
            ) : (
              <>
                <p className="whitespace-pre-line text-base font-medium text-ink">{a.prompt}</p>
                <div className="rounded-md bg-surface-soft px-3.5 py-3">
                  <p className="text-xs font-medium text-muted">Student&apos;s answer</p>
                  <p className={`mt-0.5 whitespace-pre-wrap break-words text-[15px] ${(isChoice ? a.selectedOption !== null : a.answerText) ? "text-ink" : "text-muted"}`}>
                    {isChoice ? optionLabel(a, lang, a.selectedOption) : (a.answerText ?? "(no answer)")}
                  </p>
                </div>
              </>
            )}

            {isChoice && <QuestionOutcome outcome={{ state: a.state as "correct" | "incorrect" | "unanswered", points: a.pointsEarned, maxPoints: a.points }} />}
            {!isChoice && a.state === "unanswered" && <QuestionOutcome outcome={{ state: "unanswered", points: 0, maxPoints: a.points }} />}

            {(isChoice || a.referenceAnswer) && (
              <div className="rounded-md border border-dashed border-muted-soft px-3.5 py-3">
                <Badge tone="outline">Professor only</Badge>
                {isChoice ? (
                  <p className="mt-2 text-sm text-body">Key: {a.correctOption === null ? "not set" : optionLabel(a, lang, a.correctOption)}</p>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-body">Your notes: {a.referenceAnswer}</p>
                )}
              </div>
            )}

            {isManual && (
              <div className="max-w-xs">
                <label htmlFor={`points-${a.questionId}`} className="mb-1.5 block text-sm font-medium text-ink">
                  Points for this answer
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`points-${a.questionId}`}
                    name={`points:${a.questionId}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={a.points}
                    step="0.5"
                    className="max-w-28"
                    value={points[a.questionId] ?? ""}
                    aria-invalid={showError || undefined}
                    aria-describedby={`points-${a.questionId}-help`}
                    onChange={(e) => setPoints((p) => ({ ...p, [a.questionId]: e.target.value }))}
                    onBlur={() => setTouched((t) => ({ ...t, [a.questionId]: true }))}
                  />
                  <span className="text-sm text-muted">of {a.points}</span>
                </div>
                <p id={`points-${a.questionId}-help`} className={`mt-1.5 text-xs ${showError ? "text-error" : "text-muted"}`}>
                  {showError ? check!.error : "Whole or half points, from 0 to the maximum."}
                </p>
              </div>
            )}

            <TextareaField
              label="Comment on this answer"
              name={`comment:${a.questionId}`}
              optional
              rows={2}
              maxLength={2000}
              value={comments[a.questionId] ?? ""}
              onChange={(e) => setComments((c) => ({ ...c, [a.questionId]: e.target.value }))}
              errors={state?.fieldErrors?.[`comment:${a.questionId}`]}
            />
          </Card>
        );
      })}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Result</CardTitle>
          {final ? (
            <Badge tone="success">
              <CheckIcon /> Final once saved
            </Badge>
          ) : (
            <Badge tone="warning">
              <ClockIcon /> Pending
            </Badge>
          )}
        </div>
        <p className="mt-2 text-lg text-ink" aria-live="polite">
          <span className="font-medium tabular-nums">
            {running.points} of {pts(maxTotal)}
          </span>{" "}
          <span className="text-sm text-muted">
            {final ? "when you save" : `so far, ${running.missing} ${running.missing === 1 ? "question still needs" : "questions still need"} points`}
          </span>
        </p>
        <p className="mb-4 mt-1 text-sm text-muted">The student sees the result with your feedback as soon as you save.</p>
        <div className="space-y-4">
          <TextareaField
            label="Feedback for the student"
            name="feedback"
            optional
            rows={4}
            maxLength={5000}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            errors={state?.fieldErrors?.feedback}
          />
          {state?.error && !state.fieldErrors?.feedback && <Alert tone="error">{state.error}</Alert>}
          {state?.success && <Alert tone="success">{state.success}</Alert>}
          <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={incomplete.length > 0 || invalid.length > 0 || saving} aria-busy={saving}>
            {saving ? "Saving…" : "Save grading"}
          </Button>
          {incomplete.length > 0 || invalid.length > 0 ? (
            <p className="text-sm text-muted">
              Before you can save: enter valid points for{" "}
              {manual
                .filter((_, i) => checks[i].error !== null)
                .map((m) => `question ${submission.answers.findIndex((x) => x.questionId === m.questionId) + 1}`)
                .join(", ")}
              .
            </p>
          ) : null}
        </div>
      </Card>
    </form>
  );
}
