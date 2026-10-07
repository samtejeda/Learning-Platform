"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OwnedExam } from "@/lib/data/exams";
import {
  createQuestion,
  deleteExam,
  deleteQuestion,
  publishExam,
  reorderQuestions,
  unpublishExam,
  updateExam,
  updateQuestion,
} from "@/lib/exams/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardTitle } from "@/components/ui/card";
import { ActionButton } from "./action-button";
import { ExamForm } from "./exam-form";
import { QUESTION_TYPE_LABELS, QuestionForm } from "./question-form";

/**
 * Plain professor builder: exam details, question list (edit / move / delete),
 * add-a-question, and publish. Everything is editable at any time; the
 * server refuses (with a message) the edits that would break stored answers
 * once students have started, and re-checks completeness on published exams.
 */
export function ExamBuilder({ exam }: { exam: OwnedExam }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draft = exam.status === "draft";

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= exam.questions.length) return;
    const ids = exam.questions.map((q) => q.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    start(async () => {
      const result = await reorderQuestions(exam.id, { orderedIds: ids });
      setError(result?.error ?? null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Status</CardTitle>
          <Badge tone={draft ? "outline" : "success"}>{draft ? "Draft" : "Published"}</Badge>
        </div>
        {exam.attemptCount > 0 && (
          <p className="mb-3 text-sm text-muted">
            {exam.attemptCount} attempt{exam.attemptCount === 1 ? "" : "s"} started. You can still fix wording, keys and
            option text (students in progress see changes immediately). Adding, deleting or reordering questions, and
            changing the number or order of options, is blocked.
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {draft ? (
            <ActionButton variant="primary" action={() => publishExam(exam.id)}>
              Publish
            </ActionButton>
          ) : (
            <ActionButton
              confirmMessage={exam.attemptCount > 0 ? "Unpublish? Students will stop seeing this exam and their results until you publish it again." : undefined}
              action={() => unpublishExam(exam.id)}
            >
              Unpublish
            </ActionButton>
          )}
          {exam.attemptCount === 0 && (
            <ActionButton variant="danger" confirmMessage="Delete this exam?" action={() => deleteExam(exam.id)}>
              Delete exam
            </ActionButton>
          )}
        </div>
      </Card>

      <Card>
        <CardTitle>Details</CardTitle>
        <div className="mt-3">
          <ExamForm
            action={updateExam.bind(null, exam.id)}
            initial={exam}
            submitLabel="Save details"
          />
        </div>
      </Card>

      <Card>
        <CardTitle>Questions ({exam.questions.length})</CardTitle>
        {error && <Alert tone="error">{error}</Alert>}
        {exam.questions.length === 0 && <p className="mt-2 text-sm text-muted">No questions yet.</p>}
        <ol className="mt-3 divide-y divide-hairline">
          {exam.questions.map((q, i) => (
            <li key={q.id} className="py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium tabular-nums">{i + 1}.</span>
                <Badge tone="outline">{QUESTION_TYPE_LABELS[q.type]}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{q.promptEn || q.promptEs || "(no prompt yet)"}</span>
                {exam.attemptCount === 0 && (
                  <>
                    <Button type="button" size="sm" variant="ghost" disabled={pending || i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</Button>
                    <Button type="button" size="sm" variant="ghost" disabled={pending || i === exam.questions.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</Button>
                  </>
                )}
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-ink">Edit</summary>
                <div className="mt-3 space-y-3">
                  <QuestionForm action={updateQuestion.bind(null, q.id)} question={q} submitLabel="Save question" />
                  {exam.attemptCount === 0 && (
                    <ActionButton variant="danger" confirmMessage="Delete this question?" action={() => deleteQuestion(q.id)}>
                      Delete question
                    </ActionButton>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ol>
      </Card>

      {exam.attemptCount === 0 && (
        <Card variant="outlined">
          <CardTitle>Add a question</CardTitle>
          <div className="mt-3">
            <QuestionForm action={createQuestion.bind(null, exam.id)} submitLabel="Add question" />
          </div>
        </Card>
      )}
    </div>
  );
}
