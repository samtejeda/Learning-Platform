"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StudentAttempt } from "@/lib/data/exam-attempts";
import { submitExamAttempt } from "@/lib/exams/actions";
import { TRUE_FALSE_LABELS } from "@/lib/exams/language";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Answer = { selectedOption?: number; answerText?: string };
const AUTOSAVE_MS = 30_000;

function format(seconds: number) {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Taking an exam. The countdown is only a display: the server enforces the
 * deadline. Answers autosave every ~30 s (and on blur) to
 * PUT /api/exams/attempts/[id]/answers so a dropped connection near the end
 * doesn't lose work; submitting sends the full set to the server action.
 */
export function ExamAttemptForm({
  attemptId,
  language,
  deadlineIso,
  questions,
  saved,
}: {
  attemptId: string;
  language: "es" | "en";
  deadlineIso: string;
  questions: StudentAttempt["questions"];
  saved: StudentAttempt["answers"];
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, Answer>>(() =>
    Object.fromEntries(
      saved.map((a) => [a.questionId, a.selectedOption !== null ? { selectedOption: a.selectedOption } : { answerText: a.answerText ?? "" }]),
    ),
  );
  const answersRef = useRef(answers);
  const dirty = useRef(false);
  const [remaining, setRemaining] = useState(() => Math.round((new Date(deadlineIso).getTime() - Date.now()) / 1000));
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const payload = useCallback(
    (): { answers: { questionId: string; selectedOption?: number; answerText?: string }[] } => ({
      answers: Object.entries(answersRef.current).flatMap(([questionId, a]): { questionId: string; selectedOption?: number; answerText?: string }[] =>
        a.selectedOption !== undefined
          ? [{ questionId, selectedOption: a.selectedOption }]
          : a.answerText !== undefined && a.answerText.trim() !== ""
            ? [{ questionId, answerText: a.answerText }]
            : [],
      ),
    }),
    [],
  );

  const save = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    try {
      const res = await fetch(`/api/exams/attempts/${attemptId}/answers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      if (res.status === 409) return router.refresh(); // expired or already submitted
      if (!res.ok) throw new Error();
      setNote("Saved");
    } catch {
      dirty.current = true;
      setNote("Couldn't save — will retry");
    }
  }, [attemptId, payload, router]);

  function update(questionId: string, a: Answer) {
    answersRef.current = { ...answersRef.current, [questionId]: a };
    setAnswers(answersRef.current);
    dirty.current = true;
  }

  useEffect(() => {
    const t = setInterval(() => void save(), AUTOSAVE_MS);
    return () => clearInterval(t);
  }, [save]);

  useEffect(() => {
    const t = setInterval(() => {
      const left = Math.round((new Date(deadlineIso).getTime() - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(t);
        void save().finally(() => router.refresh());
      }
    }, 1000);
    return () => clearInterval(t);
  }, [deadlineIso, router, save]);

  async function submit() {
    if (!window.confirm("Submit your answers? You can't change them afterwards.")) return;
    setSubmitting(true);
    setError(null);
    const result = await submitExamAttempt(attemptId, payload());
    setSubmitting(false);
    if (result?.error) setError(result.error);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex items-center justify-between rounded-md border border-hairline bg-canvas px-4 py-2 text-sm">
        <span className="tabular-nums font-medium" aria-live="off">{format(remaining)}</span>
        <span className="text-muted">{note}</span>
      </div>
      {error && <Alert tone="error">{error}</Alert>}

      {questions.map((q, i) => {
        const a = answers[q.id] ?? {};
        return (
          <Card key={q.id}>
            <fieldset>
              <legend className="mb-3 text-[15px] font-medium">
                {i + 1}. {q.prompt}
              </legend>
              {q.type === "multiple_choice" || q.type === "true_false" ? (
                <div className="space-y-2">
                  {(q.type === "true_false" ? [...TRUE_FALSE_LABELS[language]] : (q.options ?? [])).map((label, idx) => (
                    <label key={idx} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-hairline px-3 py-2">
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        checked={a.selectedOption === idx}
                        onChange={() => {
                          update(q.id, { selectedOption: idx });
                          void save();
                        }}
                      />
                      <span className="text-sm">{label}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <textarea
                  className="w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm"
                  rows={q.type === "short_essay" ? 8 : 2}
                  maxLength={q.type === "short_essay" ? 10000 : 500}
                  value={a.answerText ?? ""}
                  aria-label={`Answer ${i + 1}`}
                  onChange={(e) => update(q.id, { answerText: e.target.value })}
                  onBlur={() => void save()}
                />
              )}
            </fieldset>
          </Card>
        );
      })}

      <Button type="button" onClick={submit} disabled={submitting} fullWidth>
        {submitting ? "Submitting…" : "Submit answers"}
      </Button>
    </div>
  );
}
