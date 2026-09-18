"use client";

import { useId, useState, useTransition } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldShell, controlAria } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";

// Contract (backend-builder): POST /api/lectures/[id]/comprehension
//   body { answer: string }  → 200 { correct: boolean, feedback?: string }
// The answer key never reaches the client; the server compares.

type Props = {
  lectureId: string;
  question: string;
  /** Multiple-choice options; null/empty → free-text answer. */
  options?: string[] | null;
};

export function ComprehensionQuestion({ lectureId, question, options }: Props) {
  const id = useId();
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<{ correct: boolean; feedback?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isChoice = !!options?.length;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!answer.trim()) {
      setError("Choose or write an answer first.");
      return;
    }
    setError(null);
    start(async () => {
      try {
        const res = await fetch(`/api/lectures/${encodeURIComponent(lectureId)}/comprehension`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ answer: answer.trim() }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setResult((await res.json()) as { correct: boolean; feedback?: string });
      } catch {
        setError("We couldn't check your answer. Please try again.");
      }
    });
  }

  return (
    <Card>
      <CardTitle>Quick check</CardTitle>
      <p className="mt-2 text-[15px] text-body-strong">{question}</p>

      {result?.correct ? (
        <div className="mt-4">
          <Alert tone="success">{result.feedback ?? "That's right."}</Alert>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          {result && !result.correct && (
            <Alert tone="warning">{result.feedback ?? "Not quite — have another look and try again."}</Alert>
          )}

          {isChoice ? (
            <fieldset className="space-y-2">
              <legend className="sr-only">Choose one answer</legend>
              {options!.map((opt, i) => {
                const optId = `${id}-opt-${i}`;
                const selected = answer === opt;
                return (
                  <label
                    key={optId}
                    htmlFor={optId}
                    className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3.5 py-2.5 text-[15px] transition-colors has-[:focus-visible]:focus-ring ${
                      selected ? "border-primary bg-canvas text-ink" : "border-hairline bg-canvas text-body hover:bg-surface-soft"
                    }`}
                  >
                    <input
                      id={optId}
                      type="radio"
                      name={`${id}-answer`}
                      value={opt}
                      checked={selected}
                      onChange={() => setAnswer(opt)}
                      className="size-4 accent-primary"
                    />
                    <span>{opt}</span>
                  </label>
                );
              })}
            </fieldset>
          ) : (
            <FieldShell label="Your answer" id={`${id}-answer`} errors={error ? [error] : undefined}>
              <Textarea
                {...controlAria(`${id}-answer`, error ? [error] : undefined)}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={3}
                maxLength={1000}
              />
            </FieldShell>
          )}

          <Button type="submit" disabled={pending} aria-busy={pending} fullWidth className="sm:w-auto">
            {pending ? "Checking…" : "Check answer"}
          </Button>
        </form>
      )}
    </Card>
  );
}
