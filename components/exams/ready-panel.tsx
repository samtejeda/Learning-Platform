"use client";

import type { OwnedExam } from "@/lib/data/exams";
import { deleteExam, publishExam, unpublishExam } from "@/lib/exams/actions";
import { examPublishProblems, type PublishProblem } from "@/lib/exams/publish-rules";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "./confirm-action";
import { CheckIcon, WarnIcon } from "./status-icons";

/** The exam's open problems, from the same pure rules the server re-checks when publishing. */
export function examProblems(exam: OwnedExam): PublishProblem[] {
  return examPublishProblems(
    { titleEs: exam.titleEs, titleEn: exam.titleEn },
    exam.questions.map((q) => ({
      type: q.type,
      promptEs: q.promptEs,
      promptEn: q.promptEn,
      optionsEs: q.optionsEs,
      optionsEn: q.optionsEn,
      correctOption: q.correctOption,
    })),
  );
}

/**
 * "Ready to publish": names exactly what is missing (with a link to jump to
 * it) and says plainly what Publish will do. Also holds unpublish and delete,
 * each behind an inline confirmation.
 */
export function ReadyPanel({
  exam,
  problems,
  onJump,
}: {
  exam: OwnedExam;
  problems: PublishProblem[];
  onJump: (question: number | null) => void;
}) {
  const draft = exam.status === "draft";
  const started = exam.attemptCount > 0;
  const examLevel = problems.filter((p) => p.question === null);
  const byQuestion = new Map<number, string[]>();
  for (const p of problems) if (p.question !== null) byQuestion.set(p.question, [...(byQuestion.get(p.question) ?? []), p.message]);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <CardTitle>{draft ? "Ready to publish?" : "Published"}</CardTitle>
        <Badge tone={draft ? "outline" : "success"}>{draft ? "Draft: students can't see it" : "Live: students can take it"}</Badge>
      </div>

      {problems.length > 0 ? (
        <div className="mb-4 space-y-3">
          <p className="flex items-center gap-2 text-sm font-medium text-warning-strong">
            <WarnIcon />
            {problems.length} {problems.length === 1 ? "thing needs" : "things need"} fixing{draft ? " before you can publish" : ""}
          </p>
          <ul role="list" className="space-y-2">
            {examLevel.map((p) => (
              <li key={p.message} className="text-sm text-body">
                <a
                  href="#exam-details"
                  className="rounded-sm font-medium text-ink underline underline-offset-2 hover:no-underline focus-visible:focus-ring"
                  onClick={(e) => {
                    e.preventDefault();
                    onJump(null);
                  }}
                >
                  Exam details
                </a>
                : {p.message}
              </li>
            ))}
            {[...byQuestion.entries()].map(([n, messages]) => (
              <li key={n} className="text-sm text-body">
                <a
                  href={`#question-${n}`}
                  className="rounded-sm font-medium text-ink underline underline-offset-2 hover:no-underline focus-visible:focus-ring"
                  onClick={(e) => {
                    e.preventDefault();
                    onJump(n);
                  }}
                >
                  Question {n}
                </a>
                <ul className="mt-0.5 list-disc pl-5">
                  {messages.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mb-4 flex items-center gap-2 text-sm font-medium text-success-strong">
          <CheckIcon />
          Everything is filled in, in both languages.
        </p>
      )}

      {started && (
        <p className="mb-4 text-sm text-muted">
          {exam.attemptCount} {exam.attemptCount === 1 ? "attempt has" : "attempts have"} been started. You can still fix wording and the correct answers (scores update to match). You can&apos;t add, delete or reorder questions, or change the number of options or blanks.
        </p>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start">
        {draft ? (
          <ConfirmAction
            variant="primary"
            action={() => publishExam(exam.id)}
            disabled={problems.length > 0}
            disabledReason="Fix the items above to publish."
            confirm={{
              title: "Publish this exam?",
              body: "Students enrolled in this course will see it right away and can start an attempt. You can still fix mistakes afterwards.",
              confirmLabel: "Yes, publish",
            }}
            busyLabel="Publishing…"
          >
            Publish and show to students
          </ConfirmAction>
        ) : (
          <ConfirmAction
            action={() => unpublishExam(exam.id)}
            confirm={{
              title: "Hide this exam from students?",
              body: started
                ? "Students will stop seeing this exam and their results until you publish it again. Nothing is deleted."
                : "Students will stop seeing this exam. Nothing is deleted, and you can publish it again.",
              confirmLabel: "Yes, hide it",
            }}
            busyLabel="Hiding…"
          >
            Unpublish (hide from students)
          </ConfirmAction>
        )}
        {!started ? (
          <ConfirmAction
            variant="danger"
            action={() => deleteExam(exam.id)}
            confirm={{
              title: "Delete this exam?",
              body: "This permanently removes the exam and all its questions. It can't be undone.",
              confirmLabel: "Yes, delete the exam",
            }}
            busyLabel="Deleting…"
          >
            Delete exam
          </ConfirmAction>
        ) : (
          <p className="text-sm text-muted sm:max-w-xs">This exam can&apos;t be deleted because students have started it. You can unpublish it instead.</p>
        )}
      </div>
    </Card>
  );
}
