"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_CONTENT_LANGUAGE, type ContentLanguage } from "@/lib/exams/language";
import type { ComprehensionStatus } from "@/lib/lectures/comprehension";
import { CheckIcon, WarnIcon } from "@/components/exams/status-icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { SegmentedRadio } from "@/components/ui/segmented-radio";
import {
  applyResponse,
  attemptsLeftText,
  checkErrorMessage,
  parseCheckResponse,
  type CardQuestion,
  type CardState,
} from "./comprehension-view";

type Initial = { status: ComprehensionStatus; attemptsRemaining: number; question: CardQuestion | null };

/**
 * The student's end-of-lecture question. It renders only what the server gave
 * it (which question, how many attempts remain) and sends the chosen option's
 * POSITION, so Spanish and English readers are scored identically. It never
 * fetches or holds an answer key. The language switch is display-only; its
 * default is the one place a student-level language setting will plug in.
 * Answering gates nothing in this release.
 */
export function ComprehensionQuestion({
  lectureId,
  initial,
  defaultLanguage = DEFAULT_CONTENT_LANGUAGE,
}: {
  lectureId: string;
  initial: Initial;
  defaultLanguage?: ContentLanguage;
}) {
  const uid = useId();
  const router = useRouter();
  const [state, setState] = useState<CardState>({ ...initial, lastWrong: false, answeredNow: false });
  const [language, setLanguage] = useState<ContentLanguage>(defaultLanguage);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const resultRef = useRef<HTMLDivElement>(null);
  const [focusTick, setFocusTick] = useState(0);

  // After an answer, move focus to the result so a screen reader announces it.
  useEffect(() => {
    if (focusTick > 0) resultRef.current?.focus();
  }, [focusTick]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (selected === null) {
      setError("Choose an answer first.");
      return;
    }
    setError(null);
    start(async () => {
      try {
        const res = await fetch(`/api/lectures/${encodeURIComponent(lectureId)}/comprehension`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ selectedOption: selected }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
          const { message, resync } = checkErrorMessage(res.status, body?.error?.code ?? null);
          setError(message);
          if (resync) router.refresh();
          return;
        }
        const parsed = parseCheckResponse(await res.json());
        if (!parsed) throw new Error("bad_shape");
        setState(applyResponse(parsed));
        setSelected(null);
        setFocusTick((t) => t + 1);
      } catch {
        setError("We couldn't check your answer. Please try again.");
      }
    });
  }

  const question = state.question?.[language] ?? null;

  return (
    <Card variant="outlined" aria-labelledby={`${uid}-title`} role="region">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <CardTitle id={`${uid}-title`}>Quick check</CardTitle>
        {state.question && (
          <div className="w-full sm:w-48">
            <SegmentedRadio
              legend="Language"
              name={`${uid}-lang`}
              value={language}
              onChange={setLanguage}
              options={[
                { value: "es", label: "Español" },
                { value: "en", label: "English" },
              ]}
            />
          </div>
        )}
      </div>

      <div ref={resultRef} tabIndex={-1} className="focus:outline-none">
        {state.status === "passed" && (
          <Alert tone="success">
            <p className="flex items-center gap-2 font-medium">
              <CheckIcon />
              {state.answeredNow ? "That's right. Nice work." : "You answered this question correctly."}
            </p>
          </Alert>
        )}
        {state.status === "blocked" && (
          <Alert tone="info">
            <p>
              {state.lastWrong ? "That wasn't the right answer, and you've used both attempts on this question." : "You've used both attempts on this question."}
            </p>
          </Alert>
        )}
        {(state.status === "retry" || state.status === "open") && state.lastWrong && (
          <Alert tone="warning">
            <p className="flex items-center gap-2 font-medium">
              <WarnIcon />
              Not quite. {attemptsLeftText(state.attemptsRemaining)} Read the next question carefully.
            </p>
          </Alert>
        )}
        {state.status === "retry" && !state.lastWrong && <Alert tone="info">{attemptsLeftText(state.attemptsRemaining)}</Alert>}
      </div>

      {question && (
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <fieldset className="min-w-0 space-y-2">
            <legend className="mb-3 whitespace-pre-line text-base font-medium text-ink">{question.prompt}</legend>
            {question.options.map((opt, i) => {
              const optId = `${uid}-opt-${i}`;
              const on = selected === i;
              return (
                <label
                  key={optId}
                  htmlFor={optId}
                  className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3.5 py-2.5 text-[15px] transition-colors has-[:focus-visible]:focus-ring ${
                    on ? "border-primary bg-surface-card text-ink" : "border-hairline bg-canvas text-body hover:bg-surface-soft"
                  }`}
                >
                  <input
                    id={optId}
                    type="radio"
                    name={`${uid}-answer`}
                    checked={on}
                    onChange={() => {
                      setSelected(i);
                      setError(null);
                    }}
                    className="size-5 shrink-0 accent-primary focus:outline-none"
                  />
                  <span className="min-w-0 break-words">{opt}</span>
                </label>
              );
            })}
          </fieldset>
          <Button type="submit" disabled={pending} aria-busy={pending} fullWidth className="min-h-11 sm:w-auto">
            {pending ? "Checking…" : "Check answer"}
          </Button>
        </form>
      )}
    </Card>
  );
}
