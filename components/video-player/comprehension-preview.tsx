"use client";

import { useId, useState } from "react";
import { DEFAULT_CONTENT_LANGUAGE, type ContentLanguage } from "@/lib/exams/language";
import type { PreviewQuestion } from "@/components/lecture-comprehension/question-model";
import { SegmentedRadio } from "@/components/ui/segmented-radio";

/**
 * Read-only "what the student sees": the written question(s), one language at
 * a time. Static (options are not controls, so no extra tab stops beyond the
 * language switch) and key-free by construction: its props carry no key. Used
 * by the authoring form (live from the draft) and by the instructor's lecture
 * preview. It never calls the check route.
 */
export function ComprehensionPreview({
  questions,
  heading,
  intro,
  defaultLanguage = DEFAULT_CONTENT_LANGUAGE,
}: {
  questions: PreviewQuestion[];
  heading: string;
  intro?: string;
  defaultLanguage?: ContentLanguage;
}) {
  const uid = useId();
  const [lang, setLang] = useState<ContentLanguage>(defaultLanguage);
  const hint = <span className="text-muted">(nothing written yet)</span>;

  return (
    <section aria-label={heading} className="rounded-lg border border-dashed border-muted-soft p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{heading}</p>
          {intro && <p className="mt-0.5 text-sm text-muted">{intro}</p>}
        </div>
        <div className="w-full sm:w-48">
          <SegmentedRadio
            legend="Preview language"
            name={`${uid}-lang`}
            value={lang}
            onChange={setLang}
            options={[
              { value: "es", label: "Español" },
              { value: "en", label: "English" },
            ]}
          />
        </div>
      </div>

      {questions.length === 0 ? (
        <p className="rounded-md bg-canvas p-4 text-sm text-muted">Nothing is written yet.</p>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => {
            const view = q[lang];
            return (
              <div key={q.slot} className="rounded-md bg-canvas p-4">
                <p className="mb-2 text-xs font-medium text-muted">
                  Question {q.slot}
                  {q.slot === 2 ? " · asked on the second attempt" : ""}
                </p>
                <p className="whitespace-pre-line text-base font-medium text-ink">{view.prompt.trim() ? view.prompt : hint}</p>
                <ul role="list" className="mt-3 space-y-2">
                  {view.options.map((label, i) => (
                    <li key={i} className="flex min-h-12 items-center gap-3 rounded-md border border-hairline px-3.5 py-2.5">
                      <span aria-hidden className="size-5 shrink-0 rounded-full border border-muted-soft" />
                      <span className="min-w-0 flex-1 break-words text-[15px] text-ink">
                        {label.trim() ? label : <span className="text-muted">(empty option)</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
