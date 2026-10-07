"use client";

import { useState } from "react";
import { TRUE_FALSE_LABELS } from "@/lib/exams/language";
import { SegmentedRadio } from "@/components/ui/segmented-radio";
import { BLANK_SIZE } from "./blank-style";
import type { QuestionDraft } from "./question-model";

type Lang = "es" | "en";

/**
 * "What the student sees": the question as an answer sheet draws it, one
 * language at a time. Static (nothing here can be tapped into), so it adds no
 * tab stops; the same shapes the attempt page uses for options and blanks.
 */
export function QuestionPreview({ draft, name }: { draft: QuestionDraft; name: string }) {
  const [lang, setLang] = useState<Lang>("en");
  if (!draft.type) return null;
  const segments = lang === "es" ? draft.promptEs : draft.promptEn;
  const options = draft.options.map((o) => (lang === "es" ? o.es : o.en));
  const emptyHint = <span className="text-muted">(nothing written yet)</span>;

  return (
    <section aria-label="Preview of what the student sees" className="rounded-lg border border-dashed border-muted-soft p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm font-medium text-ink">What the student sees</p>
        <div className="w-48">
          <SegmentedRadio
            legend="Preview language"
            name={name}
            value={lang}
            onChange={setLang}
            options={[
              { value: "es", label: "Español" },
              { value: "en", label: "English" },
            ]}
          />
        </div>
      </div>
      <div className="rounded-md bg-canvas p-4">
        <p className="whitespace-pre-line text-base font-medium text-ink">
          {draft.type === "fill_in_the_blank" ? (
            segments.every((s) => !s.trim()) && segments.length === 1 ? (
              emptyHint
            ) : (
              segments.map((s, i) => (
                <span key={i}>
                  {s}
                  {i < segments.length - 1 && (
                    <span
                      className={`mx-1 inline-block ${BLANK_SIZE} rounded-md border border-hairline bg-canvas align-middle`}
                      role="img"
                      aria-label={`Blank ${i + 1}`}
                    />
                  )}
                </span>
              ))
            )
          ) : segments[0]?.trim() ? (
            segments[0]
          ) : (
            emptyHint
          )}
        </p>

        {(draft.type === "multiple_choice" || draft.type === "true_false") && (
          <ul role="list" className="mt-3 space-y-2">
            {(draft.type === "true_false" ? [...TRUE_FALSE_LABELS[lang]] : options).map((label, i) => (
              <li key={i} className="flex min-h-12 items-center gap-3 rounded-md border border-hairline px-3.5 py-2.5">
                <span aria-hidden className="size-5 shrink-0 rounded-full border border-muted-soft" />
                <span className="min-w-0 flex-1 break-words text-[15px] text-ink">{label.trim() ? label : <span className="text-muted">(empty option)</span>}</span>
              </li>
            ))}
          </ul>
        )}
        {draft.type === "short_essay" && <div aria-hidden className="mt-3 h-24 rounded-md border border-hairline" />}
      </div>
    </section>
  );
}
