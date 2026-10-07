"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StudentAttempt } from "@/lib/data/exam-attempts";
import { submitExamAttempt } from "@/lib/exams/actions";
import { splitOnBlanks } from "@/lib/exams/blanks";
import { TRUE_FALSE_LABELS } from "@/lib/exams/language";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { ExamTimer } from "./exam-timer";

type Answer = { selectedOption?: number; answerText?: string; blanks?: string[] };
type WireAnswer = { questionId: string; selectedOption?: number; answerText?: string; blanks?: string[] };
const AUTOSAVE_MS = 30_000;
const MAX_ESSAY = 10000;
const MAX_SHORT = 500;

const isAnswered = (a: Answer | undefined) =>
  !!a &&
  (a.selectedOption !== undefined ||
    (a.answerText !== undefined && a.answerText.trim() !== "") ||
    (a.blanks !== undefined && a.blanks.length > 0 && a.blanks.every((b) => b.trim() !== "")));

/**
 * Taking an exam. The countdown is only a display: the server enforces the
 * deadline. Answers autosave every ~30 s (and on blur / choice) to
 * PUT /api/exams/attempts/[id]/answers so a dropped connection near the end
 * doesn't lose work; submitting sends the full set to the server action,
 * after an inline confirmation.
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
      saved.map((a) => [
        a.questionId,
        a.selectedOption !== null
          ? { selectedOption: a.selectedOption }
          : a.blankAnswers
            ? { blanks: a.blankAnswers }
            : { answerText: a.answerText ?? "" },
      ]),
    ),
  );
  const answersRef = useRef(answers);
  const dirty = useRef(false);
  const [saveState, setSaveState] = useState<{ kind: "idle" } | { kind: "saved"; at: string } | { kind: "failed" }>({ kind: "idle" });
  // Screen-reader text for the save status: only failures and recovery, so
  // choosing an option never produces a stream of "Saved" announcements.
  const [saveAnnouncement, setSaveAnnouncement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const submitWrapRef = useRef<HTMLDivElement>(null);
  const failedBefore = useRef(false);

  const payload = useCallback(
    (): { answers: WireAnswer[] } => ({
      answers: Object.entries(answersRef.current).flatMap(([questionId, a]): WireAnswer[] =>
        a.selectedOption !== undefined
          ? [{ questionId, selectedOption: a.selectedOption }]
          : a.blanks !== undefined
            ? [{ questionId, blanks: a.blanks }]
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
      setSaveState({ kind: "saved", at: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) });
      if (failedBefore.current) {
        failedBefore.current = false;
        setSaveAnnouncement("Answers saved.");
      }
    } catch {
      dirty.current = true;
      failedBefore.current = true;
      setSaveState({ kind: "failed" });
      setSaveAnnouncement("Couldn't save your answers. Will retry.");
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

  // Time's up: flush what's typed, then let the server close the attempt.
  const onExpire = useCallback(() => {
    void save().finally(() => router.refresh());
  }, [save, router]);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const answeredCount = questions.filter((q) => isAnswered(answers[q.id])).length;
  const unanswered = questions.length - answeredCount;

  async function submit() {
    setSubmitting(true);
    setError(null);
    const result = await submitExamAttempt(attemptId, payload());
    setSubmitting(false);
    if (result?.error) {
      setError(result.error);
      setConfirming(false);
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-10 -mx-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-hairline bg-canvas px-4 py-2.5 sm:top-16">
        <ExamTimer deadlineIso={deadlineIso} onExpire={onExpire} />
        <div className="flex items-baseline gap-3 text-xs text-muted">
          <span className="tabular-nums">
            {answeredCount} of {questions.length} answered
          </span>
          <span className={saveState.kind === "failed" ? "font-medium text-warning-strong" : ""}>
            {saveState.kind === "saved" ? `Saved ${saveState.at}` : saveState.kind === "failed" ? "Couldn't save — will retry" : "Autosaves as you go"}
          </span>
        </div>
        <p role="status" className="sr-only">
          {saveAnnouncement}
        </p>
      </div>

      {questions.map((q, i) => {
        const a = answers[q.id] ?? {};
        const isText = q.type === "fill_in_the_blank" || q.type === "short_essay";
        const multiBlank = q.type === "fill_in_the_blank" && q.blankCount > 0;
        const limit = q.type === "short_essay" ? MAX_ESSAY : MAX_SHORT;
        return (
          <Card key={q.id} variant="outlined" className="sm:p-6">
            <fieldset className="min-w-0">
              <legend className="mb-4 w-full">
                <span className="mb-1 block text-xs font-medium tabular-nums text-muted">
                  Question {i + 1} of {questions.length}
                </span>
                <span className="block whitespace-pre-line text-base font-medium text-ink">
                  {multiBlank ? splitOnBlanks(q.prompt).join(" ______ ") : q.prompt}
                </span>
              </legend>
              {!isText ? (
                <div className="space-y-2">
                  {(q.type === "true_false" ? [...TRUE_FALSE_LABELS[language]] : (q.options ?? [])).map((label, idx) => (
                    <label
                      key={idx}
                      className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-hairline bg-canvas px-3.5 py-2.5 hover:bg-surface-soft has-[:checked]:border-primary has-[:checked]:bg-surface-card has-[:focus-visible]:focus-ring"
                    >
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        checked={a.selectedOption === idx}
                        className="size-5 shrink-0 accent-primary focus:outline-none"
                        onChange={() => {
                          update(q.id, { selectedOption: idx });
                          void save();
                        }}
                      />
                      <span className="min-w-0 flex-1 break-words text-[15px] text-ink">{label}</span>
                    </label>
                  ))}
                </div>
              ) : multiBlank ? (
                <div className="space-y-2">
                  {Array.from({ length: q.blankCount }, (_, n) => (
                    <Input
                      key={n}
                      maxLength={MAX_SHORT}
                      value={a.blanks?.[n] ?? ""}
                      aria-label={`Question ${i + 1}, blank ${n + 1}`}
                      onChange={(e) => {
                        const next = Array.from({ length: q.blankCount }, (_, k) => a.blanks?.[k] ?? "");
                        next[n] = e.target.value;
                        update(q.id, { blanks: next });
                      }}
                      onBlur={() => void save()}
                    />
                  ))}
                </div>
              ) : (
                <div>
                  <Textarea
                    id={`a-${q.id}`}
                    rows={q.type === "short_essay" ? 8 : 3}
                    maxLength={limit}
                    value={a.answerText ?? ""}
                    aria-label={`Answer to question ${i + 1}`}
                    aria-describedby={`a-${q.id}-count`}
                    onChange={(e) => update(q.id, { answerText: e.target.value })}
                    onBlur={() => void save()}
                  />
                  <p id={`a-${q.id}-count`} className="mt-1.5 text-right text-xs tabular-nums text-muted">
                    {(a.answerText ?? "").length} / {limit}
                  </p>
                </div>
              )}
            </fieldset>
          </Card>
        );
      })}

      {error && <Alert tone="error">{error}</Alert>}

      {confirming ? (
        <Card variant="outlined" className="space-y-4 border-primary sm:p-6" role="group" aria-labelledby="confirm-title">
          <div>
            <h2 id="confirm-title" ref={confirmRef} tabIndex={-1} className="font-sans text-lg font-medium text-ink focus:outline-none">
              Submit your answers?
            </h2>
            <p className="mt-1 text-sm text-muted">
              {unanswered > 0
                ? `${unanswered} ${unanswered === 1 ? "question is" : "questions are"} still unanswered. `
                : ""}
              You can&apos;t change your answers after submitting.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button type="button" className="min-h-11" onClick={submit} disabled={submitting} aria-busy={submitting}>
              {submitting ? "Submitting…" : "Yes, submit"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={submitting}
              onClick={() => {
                setConfirming(false);
                requestAnimationFrame(() => submitWrapRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
              }}
            >
              Keep working
            </Button>
          </div>
        </Card>
      ) : (
        <div ref={submitWrapRef}>
          <Button type="button" className="min-h-11" onClick={() => setConfirming(true)} fullWidth>
            Submit answers
          </Button>
        </div>
      )}
    </div>
  );
}
