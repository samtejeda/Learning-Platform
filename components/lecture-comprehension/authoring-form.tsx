"use client";

import { useActionState, useEffect, useId } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/validation/form";
import { COMPREHENSION_MIN_OPTIONS, OPTION_MAX_LENGTH, PROMPT_MAX_LENGTH } from "@/lib/lectures/comprehension";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { ComprehensionPreview } from "@/components/video-player/comprehension-preview";
import {
  MAX_OPTION_ROWS,
  addOptionRow,
  emptySlot,
  isBlankSlot,
  previewQuestions,
  removeOptionRow,
  saveBlockers,
  toFormFields,
  type ComprehensionDraft,
  type SlotDraft,
} from "./question-model";

const LANGS = [
  { code: "es", name: "Español" },
  { code: "en", name: "English" },
] as const;

/**
 * The authoring form for both question slots. Controlled, so typed values
 * survive a refused save. Each option is ONE row holding Español and English
 * side by side with a "Correct answer" radio, so the two languages always have
 * the same number of options in the same order (the key is a position). The
 * server stays the authority; its messages are shown as written.
 */
export function AuthoringForm({
  action,
  draft,
  onChange,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  draft: ComprehensionDraft;
  onChange: (next: ComprehensionDraft) => void;
}) {
  const uid = useId();
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  const blockers = saveBlockers(draft);
  const fields = toFormFields(draft);
  const fieldMessages = Object.values(state?.fieldErrors ?? {}).flat();

  useEffect(() => {
    // The panel's "ready" checklist reads the saved question, so refetch it.
    if (state?.success) router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const setSlot = (i: 0 | 1, next: SlotDraft) => onChange(i === 0 ? [next, draft[1]] : [draft[0], next]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (blockers.length > 0) e.preventDefault();
      }}
      noValidate
      className="space-y-6"
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      {!state?.error && fieldMessages.length > 0 && (
        <Alert tone="error">
          <ul className="list-disc pl-4">
            {fieldMessages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alert>
      )}
      {state?.success && <Alert tone="success">{state.success}</Alert>}

      {([0, 1] as const).map((i) => (
        <SlotEditor
          key={i}
          uid={`${uid}-${i}`}
          number={i === 0 ? 1 : 2}
          slot={draft[i]}
          onChange={(next) => setSlot(i, next)}
          errors={state?.fieldErrors}
        />
      ))}

      <ComprehensionPreview
        heading="What the student sees"
        intro="Students answer one question after finishing the lecture, with two attempts in total."
        questions={previewQuestions(draft)}
      />

      <div className="space-y-2">
        <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={blockers.length > 0 || pending} aria-busy={pending}>
          {pending ? "Saving…" : "Save question"}
        </Button>
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
        <p className="text-sm text-muted">You can save an unfinished question. It only has to be complete to turn it on.</p>
      </div>
    </form>
  );
}

function SlotEditor({
  uid,
  number,
  slot,
  onChange,
  errors,
}: {
  uid: string;
  number: 1 | 2;
  slot: SlotDraft;
  onChange: (next: SlotDraft) => void;
  errors?: Record<string, string[]>;
}) {
  const titleId = `${uid}-title`;
  const err = (k: string) => errors?.[`q${number}${k}`]?.[0];
  const patch = (p: Partial<SlotDraft>) => onChange({ ...slot, ...p });

  return (
    <section id={`comprehension-q${number}`} aria-labelledby={titleId} className="scroll-mt-24 space-y-4 rounded-lg border border-hairline bg-canvas p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={titleId} className="font-sans text-base font-medium text-ink">
            Question {number}
          </h3>
          <Badge tone="outline">{number === 1 ? "Required to turn on" : "Optional"}</Badge>
        </div>
        {number === 2 && !isBlankSlot(slot) && (
          <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => onChange(emptySlot())}>
            Clear question 2
          </Button>
        )}
      </div>
      <p className="text-sm text-muted">
        {number === 1
          ? "Asked first. If a student gets it wrong and you wrote no second question, they are asked this one again."
          : "Asked on the second attempt. Leave it empty to ask Question 1 again instead."}
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {LANGS.map(({ code, name }) => {
          const key = code === "es" ? "promptEs" : "promptEn";
          const serverKey = code === "es" ? "PromptEs" : "PromptEn";
          const id = `${uid}-prompt-${code}`;
          return (
            <div key={code}>
              <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
                Question text ({name})
              </label>
              <Textarea
                id={id}
                rows={3}
                maxLength={PROMPT_MAX_LENGTH}
                value={slot[key]}
                aria-invalid={err(serverKey) ? true : undefined}
                aria-describedby={err(serverKey) ? `${id}-error` : undefined}
                onChange={(e) => patch({ [key]: e.target.value })}
              />
              {err(serverKey) && (
                <p id={`${id}-error`} className="mt-1.5 text-xs text-error">
                  {err(serverKey)}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <fieldset className="min-w-0 space-y-3">
        <legend className="text-sm font-medium text-ink">Options</legend>
        <p className="text-sm text-muted">
          Write each option in both languages, then mark the correct one. {COMPREHENSION_MIN_OPTIONS} to {MAX_OPTION_ROWS} options; students see them in this order.
        </p>
        {slot.options.map((o, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-hairline bg-surface-soft p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink">Option {i + 1}</span>
              <div className="flex items-center gap-1">
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-ink has-[:checked]:bg-surface-card has-[:checked]:font-medium has-[:focus-visible]:focus-ring">
                  <input
                    type="radio"
                    name={`${uid}-correct`}
                    checked={slot.correct === i}
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
                  disabled={slot.options.length <= COMPREHENSION_MIN_OPTIONS}
                  aria-label={`Remove option ${i + 1} of question ${number}`}
                  onClick={() => onChange(removeOptionRow(slot, i))}
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
                    className="min-h-11"
                    maxLength={OPTION_MAX_LENGTH}
                    value={o[code]}
                    onChange={(e) =>
                      patch({
                        options: slot.options.map((x, k) => (k === i ? { ...x, [code]: e.target.value.replace(/[\r\n]+/g, " ") } : x)),
                      })
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
            disabled={slot.options.length >= MAX_OPTION_ROWS}
            onClick={() => onChange(addOptionRow(slot))}
          >
            Add option
          </Button>
          <span className="text-sm text-muted">
            {slot.options.length} of {MAX_OPTION_ROWS} options
          </span>
        </div>
        {(err("OptionsEs") || err("OptionsEn")) && <p className="text-xs text-error">{err("OptionsEs") ?? err("OptionsEn")}</p>}
        {err("Correct") && <p className="text-xs text-error">{err("Correct")}</p>}
      </fieldset>
    </section>
  );
}
