"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import type { ActionState } from "@/lib/validation/form";
import type { ProfessorQuestion } from "@/lib/data/exams";
import { ATTEMPT_BLOCK_MESSAGES } from "@/lib/exams/edit-rules";
import { TRUE_FALSE_LABELS } from "@/lib/exams/language";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { BlankPromptEditor } from "./blank-prompt-editor";
import { stripToken } from "./prompt-blanks";
import {
  MAX_OPTION_ROWS,
  TYPE_INFO,
  addOptionRow,
  blanksInDraft,
  changesScores,
  draftFromQuestion,
  emptyDraft,
  examTotals,
  parsePoints,
  removeOptionRow,
  saveBlockers,
  toFormFields,
  type QuestionDraft,
  type QuestionType,
} from "./question-model";
import { QuestionPreview } from "./question-preview";
import { QuestionTypePicker } from "./question-type-picker";
import { WarnIcon } from "./status-icons";

const LANGS = [
  { code: "es", name: "Español" },
  { code: "en", name: "English" },
] as const;

function LangBox({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <section aria-label={name} className="min-w-0 space-y-3 rounded-lg border border-hairline bg-canvas p-4">
      <Badge tone="outline">{name}</Badge>
      {children}
    </section>
  );
}

/**
 * The guided question form. Create: pick the type first, then only that
 * type's fields appear. Edit: the type is fixed. Everything is controlled, so
 * typed values survive a failed save; the server remains the authority and its
 * messages are shown on the field they belong to.
 */
export function QuestionEditor({
  mode,
  action,
  question,
  examQuestions,
  attemptCount,
  published,
  onSaved,
  submitLabel,
}: {
  mode: "create" | "edit";
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  question?: ProfessorQuestion;
  examQuestions: { id: string; type: QuestionType; points: number }[];
  attemptCount: number;
  published: boolean;
  onSaved?: () => void;
  submitLabel: string;
}) {
  const uid = useId();
  const formId = `${uid}-form`;
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  const [draft, setDraft] = useState<QuestionDraft>(() => (question ? draftFromQuestion(question) : emptyDraft()));
  const [confirming, setConfirming] = useState(false);
  const confirmedRef = useRef(false);
  const confirmTitleRef = useRef<HTMLHeadingElement>(null);
  const patch = (p: Partial<QuestionDraft>) => setDraft((d) => ({ ...d, ...p }));
  const err = (k: string) => state?.fieldErrors?.[k]?.[0];
  const locked = attemptCount > 0;

  useEffect(() => {
    if (state?.success) onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  useEffect(() => {
    if (confirming) confirmTitleRef.current?.focus();
  }, [confirming]);

  const type = draft.type;
  const blockers = saveBlockers(draft);
  const blanks = blanksInDraft(draft);
  const pointsNow = parsePoints(draft.points);
  const totals = examTotals(examQuestions, { id: question?.id ?? null, points: pointsNow });
  const examTotal = totals.total + (mode === "create" && type && pointsNow !== null ? pointsNow : 0);
  const needsConfirm = mode === "edit" && locked && !!question && changesScores(question, draft);
  const fields = toFormFields(draft);
  const auto = type === "multiple_choice" || type === "true_false";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (blockers.length > 0) return e.preventDefault();
    if (needsConfirm && !confirmedRef.current) {
      e.preventDefault();
      setConfirming(true);
      return;
    }
    confirmedRef.current = false;
    setConfirming(false);
  }

  return (
    <div className="space-y-5">
      <form id={formId} action={formAction} onSubmit={onSubmit} noValidate className="space-y-5">
        {state?.error && <Alert tone="error">{state.error}</Alert>}
        {state?.success && <Alert tone="success">{state.success}</Alert>}
        {Object.entries(fields)
          .filter(([k]) => k !== "points")
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}

        {mode === "create" && !question ? (
          <QuestionTypePicker
            name={`${uid}-type`}
            value={type}
            onChange={(t) => patch({ type: t, correct: null })}
            error={err("type")}
          />
        ) : (
          type && (
            <p className="text-sm text-muted">
              <span className="font-medium text-ink">{TYPE_INFO[type].label}.</span> {TYPE_INFO[type].blurb} The kind of question can&apos;t be changed after it&apos;s created.
            </p>
          )
        )}

        {type && locked && mode === "edit" && (
          <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm text-warning-strong">
            <WarnIcon />
            <p>
              {attemptCount} {attemptCount === 1 ? "attempt has" : "attempts have"} been started. Students in progress see wording changes right away.
              {auto ? " Changing the correct answer or the points re-scores every attempt." : " Changing the points changes every attempt's total."}
            </p>
          </div>
        )}
        {type && !locked && published && mode === "edit" && (
          <p className="text-sm text-muted">This exam is live, so students see your changes right away.</p>
        )}

        {type && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {LANGS.map(({ code, name }) => {
                const key = code === "es" ? "promptEs" : "promptEn";
                const segs = draft[key];
                return (
                  <LangBox key={code} name={name}>
                    {type === "fill_in_the_blank" ? (
                      <BlankPromptEditor
                        idPrefix={`${uid}-${code}`}
                        languageName={name}
                        segments={segs}
                        onChange={(next) => patch({ [key]: next })}
                        structureLocked={locked}
                        lockedReason={ATTEMPT_BLOCK_MESSAGES.blank_count}
                        error={err(key)}
                      />
                    ) : (
                      <div>
                        <label htmlFor={`${uid}-${code}-prompt`} className="mb-1.5 block text-sm font-medium text-ink">
                          Question text
                        </label>
                        <Textarea
                          id={`${uid}-${code}-prompt`}
                          rows={3}
                          maxLength={2000}
                          value={segs[0] ?? ""}
                          aria-invalid={err(key) ? true : undefined}
                          aria-describedby={err(key) ? `${uid}-${code}-prompt-error` : undefined}
                          onChange={(e) => patch({ [key]: [stripToken(e.target.value)] })}
                        />
                        {err(key) && (
                          <p id={`${uid}-${code}-prompt-error`} className="mt-1.5 text-xs text-error">
                            {err(key)}
                          </p>
                        )}
                      </div>
                    )}
                  </LangBox>
                );
              })}
            </div>

            {type === "fill_in_the_blank" && blanks.es !== blanks.en && (
              <div role="status" className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm text-warning-strong">
                <WarnIcon />
                <p>
                  The Spanish text has {blanks.es} {blanks.es === 1 ? "blank" : "blanks"} and the English text has {blanks.en}. Both need the same number before you can publish.
                </p>
              </div>
            )}

            {type === "multiple_choice" && (
              <fieldset className="min-w-0 space-y-3">
                <legend className="text-sm font-medium text-ink">Options</legend>
                <p className="text-sm text-muted">Write each option in both languages, then mark the correct one. Students see them in this order.</p>
                {draft.options.map((o, i) => (
                  <div key={i} className="space-y-3 rounded-lg border border-hairline bg-canvas p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink">Option {i + 1}</span>
                      <div className="flex items-center gap-1">
                        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-ink has-[:checked]:bg-surface-card has-[:checked]:font-medium has-[:focus-visible]:focus-ring">
                          <input
                            type="radio"
                            name={`${uid}-correct`}
                            checked={draft.correct === i}
                            onChange={() => patch({ correct: i })}
                            className="size-5 accent-primary focus:outline-none"
                          />
                          Correct answer
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="min-h-11"
                          disabled={locked || draft.options.length <= 2}
                          aria-label={`Remove option ${i + 1}`}
                          onClick={() => setDraft((d) => removeOptionRow(d, i))}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {LANGS.map(({ code, name }) => (
                        <div key={code}>
                          <label htmlFor={`${uid}-opt-${i}-${code}`} className="mb-1 block text-xs text-muted">
                            {name}
                          </label>
                          <Input
                            id={`${uid}-opt-${i}-${code}`}
                            maxLength={300}
                            value={o[code]}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                options: d.options.map((x, k) => (k === i ? { ...x, [code]: e.target.value.replace(/[\r\n]+/g, " ") } : x)),
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    disabled={locked || draft.options.length >= MAX_OPTION_ROWS}
                    onClick={() => setDraft(addOptionRow)}
                  >
                    Add option
                  </Button>
                  <span className="text-sm text-muted">
                    {draft.options.length} of {MAX_OPTION_ROWS} options · at least 2
                  </span>
                </div>
                {locked && <p className="text-sm text-muted">{ATTEMPT_BLOCK_MESSAGES.option_count}</p>}
                {(err("optionsEs") || err("optionsEn")) && <p className="text-xs text-error">{err("optionsEs") ?? err("optionsEn")}</p>}
                {err("correctOption") && <p className="text-xs text-error">{err("correctOption")}</p>}
              </fieldset>
            )}

            {type === "true_false" && (
              <fieldset className="min-w-0">
                <legend className="mb-1 text-sm font-medium text-ink">Which answer is correct?</legend>
                <p className="mb-2 text-sm text-muted">Nothing is pre-selected. Pick one.</p>
                <div className="grid grid-cols-2 gap-3">
                  {[0, 1].map((v) => (
                    <label
                      key={v}
                      className="flex min-h-16 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-hairline bg-canvas px-3 py-3 text-center hover:bg-surface-soft has-[:checked]:border-primary has-[:checked]:bg-surface-card has-[:focus-visible]:focus-ring"
                    >
                      <input
                        type="radio"
                        name={`${uid}-tf`}
                        checked={draft.correct === v}
                        onChange={() => patch({ correct: v })}
                        className="sr-only"
                      />
                      <span className="text-lg font-medium text-ink">{TRUE_FALSE_LABELS.en[v as 0 | 1]}</span>
                      <span className="text-sm text-muted">{TRUE_FALSE_LABELS.es[v as 0 | 1]}</span>
                      {draft.correct === v && <span className="mt-1 text-xs font-medium text-ink">Correct answer</span>}
                    </label>
                  ))}
                </div>
                {err("correctOption") && <p className="mt-1.5 text-xs text-error">{err("correctOption")}</p>}
              </fieldset>
            )}

            {(type === "fill_in_the_blank" || type === "short_essay") && (
              <div className="grid gap-4 md:grid-cols-2">
                {LANGS.map(({ code, name }) => {
                  const key = code === "es" ? "notesEs" : "notesEn";
                  const serverKey = code === "es" ? "referenceAnswerEs" : "referenceAnswerEn";
                  return (
                    <div key={code}>
                      <label htmlFor={`${uid}-${code}-notes`} className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-ink">
                        <span>Notes for you ({name})</span>
                        <span className="text-xs font-normal text-muted">Optional</span>
                      </label>
                      <Textarea
                        id={`${uid}-${code}-notes`}
                        rows={3}
                        maxLength={2000}
                        value={draft[key]}
                        aria-describedby={`${uid}-notes-hint`}
                        aria-invalid={err(serverKey) ? true : undefined}
                        onChange={(e) => patch({ [key]: e.target.value })}
                      />
                      {err(serverKey) && <p className="mt-1.5 text-xs text-error">{err(serverKey)}</p>}
                    </div>
                  );
                })}
                <p id={`${uid}-notes-hint`} className="text-xs text-muted md:col-span-2">
                  What a good answer looks like, to help you grade. Only you see this; students never do.
                </p>
              </div>
            )}

            <div className="max-w-xs">
              <Field
                label="Points"
                name="points"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                value={draft.points}
                onChange={(e) => patch({ points: e.target.value })}
                hint={`How much this question is worth. Exam total: ${examTotal} ${examTotal === 1 ? "point" : "points"}.`}
                errors={err("points") ? [err("points")!] : undefined}
              />
            </div>
          </>
        )}
      </form>

      {type && <QuestionPreview draft={draft} name={`${uid}-preview`} />}

      {type && (
        <div className="space-y-3">
          {confirming ? (
            <div role="group" aria-labelledby={`${uid}-confirm`} className="space-y-3 rounded-md border border-primary bg-canvas p-4">
              <div>
                <h3 id={`${uid}-confirm`} ref={confirmTitleRef} tabIndex={-1} className="font-sans text-base font-medium text-ink focus:outline-none">
                  Save and re-score existing attempts?
                </h3>
                <p className="mt-1 text-sm text-muted">
                  {attemptCount} {attemptCount === 1 ? "attempt has" : "attempts have"} been started. Every student&apos;s score updates to match this change.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row-reverse">
                <Button type="submit" form={formId} className="min-h-11" disabled={pending} onClick={() => (confirmedRef.current = true)}>
                  Yes, save and re-score
                </Button>
                <Button type="button" variant="secondary" className="min-h-11" onClick={() => setConfirming(false)}>
                  Keep editing
                </Button>
              </div>
            </div>
          ) : (
            <Button type="submit" form={formId} className="min-h-11 w-full sm:w-auto" disabled={blockers.length > 0 || pending} aria-busy={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          )}
          {blockers.length > 0 && (
            <div className="text-sm text-muted">
              <p className="font-medium text-ink">Before you can save:</p>
              <ul className="list-disc pl-5">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
