"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OwnedExam } from "@/lib/data/exams";
import { createQuestion, deleteQuestion, reorderQuestions, updateExam, updateQuestion } from "@/lib/exams/actions";
import { ATTEMPT_BLOCK_MESSAGES } from "@/lib/exams/edit-rules";
import { isAutoScored } from "@/lib/exams/scoring";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "./confirm-action";
import { ExamForm } from "./exam-form";
import { toSegments } from "./prompt-blanks";
import { TYPE_INFO, examTotals } from "./question-model";
import { QuestionEditor } from "./question-editor";
import { ReadyPanel, examProblems } from "./ready-panel";
import { CheckIcon, WarnIcon } from "./status-icons";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Guided professor builder. A checklist says what is missing and links to it;
 * each question is edited in a type-first form with a live student preview.
 * Everything is editable at any time; the server refuses (with a message) the
 * edits that would break stored answers once students have started, and the
 * controls for those edits are switched off here with the reason shown.
 */
export function ExamBuilder({ exam }: { exam: OwnedExam }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [moveError, setMoveError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [addKey, setAddKey] = useState(0);
  const [added, setAdded] = useState<string | null>(null);
  const started = exam.attemptCount > 0;
  const problems = examProblems(exam);
  const totals = examTotals(exam.questions);
  const problemCount = (n: number) => problems.filter((p) => p.question === n).length;

  function toggle(id: string, force?: boolean) {
    setOpen((cur) => {
      const next = new Set(cur);
      if (force === true || (force === undefined && !next.has(id))) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function jump(question: number | null) {
    if (question === null) {
      const el = document.getElementById("exam-details");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      requestAnimationFrame(() => el?.querySelector<HTMLElement>("input")?.focus());
      return;
    }
    const q = exam.questions[question - 1];
    if (!q) return;
    toggle(q.id, true);
    requestAnimationFrame(() => {
      const el = document.getElementById(`question-${question}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      el?.querySelector<HTMLElement>("button[aria-expanded]")?.focus();
    });
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= exam.questions.length) return;
    const ids = exam.questions.map((q) => q.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    start(async () => {
      const result = await reorderQuestions(exam.id, { orderedIds: ids });
      setMoveError(result?.error ?? null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <ReadyPanel exam={exam} problems={problems} onJump={jump} />

      <Card>
        <div id="exam-details" tabIndex={-1} className="scroll-mt-20 focus:outline-none">
          <CardTitle>Exam details</CardTitle>
          <p className="mb-4 mt-1 text-sm text-muted">The title, attempts and time limit. Both languages are needed to publish.</p>
          <ExamForm action={updateExam.bind(null, exam.id)} initial={exam} submitLabel="Save details" />
        </div>
      </Card>

      <Card>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <CardTitle>Questions</CardTitle>
          <span className="text-sm tabular-nums text-muted">{plural(exam.questions.length, "question")}</span>
        </div>
        <p className="text-sm text-muted">
          Exam total: <span className="font-medium text-ink tabular-nums">{plural(totals.total, "point")}</span>
          {exam.questions.length > 0 && (
            <>
              {" "}
              ({totals.auto} scored automatically, {totals.manual} graded by you)
            </>
          )}
        </p>
        {moveError && (
          <div className="mt-3">
            <Alert tone="error">{moveError}</Alert>
          </div>
        )}
        {started && exam.questions.length > 0 && <p className="mt-3 text-sm text-muted">{ATTEMPT_BLOCK_MESSAGES.reorder_questions}</p>}
        {exam.questions.length === 0 && <p className="mt-4 text-sm text-muted">No questions yet. Add the first one below.</p>}

        <ol className="mt-3 divide-y divide-hairline">
          {exam.questions.map((q, i) => {
            const isOpen = open.has(q.id);
            const gaps = problemCount(i + 1);
            const text = q.type === "fill_in_the_blank" ? toSegments(q.promptEn || q.promptEs).join(" ____ ") : q.promptEn || q.promptEs;
            return (
              <li key={q.id} id={`question-${i + 1}`} className="scroll-mt-20 py-3">
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`editor-${q.id}`}
                    onClick={() => toggle(q.id)}
                    className="-mx-2 flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-cream-strong/60 focus-visible:focus-ring"
                  >
                    <span className="w-6 shrink-0 text-sm tabular-nums text-muted-soft">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-ink">{text || "(no question text yet)"}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <span>{TYPE_INFO[q.type].label}</span>
                        <span aria-hidden>·</span>
                        <span>{plural(q.points, "point")}</span>
                        <span aria-hidden>·</span>
                        <span>{isAutoScored(q.type) ? "Scored automatically" : "You grade it"}</span>
                        <span aria-hidden>·</span>
                        {gaps === 0 ? (
                          <span className="inline-flex items-center gap-1 text-success-strong">
                            <CheckIcon /> Complete
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-warning-strong">
                            <WarnIcon /> {plural(gaps, "thing")} to fix
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-ink">{isOpen ? "Close" : "Edit"}</span>
                  </button>
                  {!started && (
                    <div className="flex shrink-0 flex-col sm:flex-row">
                      <Button type="button" size="sm" variant="ghost" className="min-h-11 min-w-11" disabled={pending || i === 0} onClick={() => move(i, -1)} aria-label={`Move question ${i + 1} up`}>
                        ↑
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="min-h-11 min-w-11" disabled={pending || i === exam.questions.length - 1} onClick={() => move(i, 1)} aria-label={`Move question ${i + 1} down`}>
                        ↓
                      </Button>
                    </div>
                  )}
                </div>
                {isOpen && (
                  <div id={`editor-${q.id}`} className="mt-3 space-y-4 rounded-lg border border-hairline bg-surface-soft p-4">
                    <QuestionEditor
                      mode="edit"
                      action={updateQuestion.bind(null, q.id)}
                      question={q}
                      examQuestions={exam.questions}
                      attemptCount={exam.attemptCount}
                      published={exam.status === "published"}
                      submitLabel="Save question"
                    />
                    <div className="border-t border-hairline pt-4">
                      {!started ? (
                        <ConfirmAction
                          variant="danger"
                          action={() => deleteQuestion(q.id)}
                          confirm={{
                            title: `Delete question ${i + 1}?`,
                            body: "This removes the question. It can't be undone.",
                            confirmLabel: "Yes, delete the question",
                          }}
                          busyLabel="Deleting…"
                        >
                          Delete question {i + 1}
                        </ConfirmAction>
                      ) : (
                        <p className="text-sm text-muted">{ATTEMPT_BLOCK_MESSAGES.delete_question}</p>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </Card>

      {!started ? (
        <Card variant="outlined">
          <CardTitle>Add a question</CardTitle>
          {added && (
            <div className="mt-3">
              <Alert tone="success">{added}</Alert>
            </div>
          )}
          <div className="mt-4">
            <QuestionEditor
              key={addKey}
              mode="create"
              action={createQuestion.bind(null, exam.id)}
              examQuestions={exam.questions}
              attemptCount={0}
              published={exam.status === "published"}
              onSaved={() => {
                setAdded(`Question ${exam.questions.length + 1} added.`);
                setAddKey((k) => k + 1);
              }}
              submitLabel="Add question"
            />
          </div>
        </Card>
      ) : (
        <Card variant="outlined">
          <CardTitle>Add a question</CardTitle>
          <p className="mt-2 text-sm text-muted">{ATTEMPT_BLOCK_MESSAGES.add_question}</p>
        </Card>
      )}

    </div>
  );
}
