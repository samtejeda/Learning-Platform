"use client";

import { TYPE_INFO, TYPE_ORDER, type QuestionType } from "./question-model";

/** Step 1 of a new question: choose the type, each with a one-line plain description. Real radios. */
export function QuestionTypePicker({
  value,
  onChange,
  name,
  error,
}: {
  value: QuestionType | null;
  onChange: (t: QuestionType) => void;
  name: string;
  error?: string;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-medium text-ink">What kind of question is this?</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {TYPE_ORDER.map((t) => (
          <label
            key={t}
            className="flex min-h-14 cursor-pointer items-start gap-3 rounded-md border border-hairline bg-canvas px-3.5 py-3 hover:bg-surface-soft has-[:checked]:border-primary has-[:checked]:bg-surface-card has-[:focus-visible]:focus-ring"
          >
            <input
              type="radio"
              name={name}
              value={t}
              checked={value === t}
              onChange={() => onChange(t)}
              className="mt-0.5 size-5 shrink-0 accent-primary focus:outline-none"
            />
            <span className="min-w-0">
              <span className="block text-[15px] font-medium text-ink">{TYPE_INFO[t].label}</span>
              <span className="block text-sm text-muted">{TYPE_INFO[t].blurb}</span>
            </span>
          </label>
        ))}
      </div>
      {error && <p className="mt-1.5 text-xs text-error">{error}</p>}
    </fieldset>
  );
}
