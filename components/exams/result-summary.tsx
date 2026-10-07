import Link from "next/link";
import type { StudentAttemptResult } from "@/lib/data/exam-attempts";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckIcon, ClockIcon } from "./status-icons";
import { ResultFocus } from "./result-focus";

const pts = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;

/**
 * What a student sees right after submitting (and on every later visit):
 * pending vs final, the score so far in plain words, which questions wait on
 * the professor, and how many attempts are left, so they can decide whether
 * to use another one. The heading takes focus so screen readers announce it.
 */
export function ResultSummary({
  result,
  feedback,
  attemptsUsed,
  maxAttempts,
  gradeOfRecord,
  examHref,
}: {
  result: StudentAttemptResult;
  feedback: string | null;
  attemptsUsed: number;
  maxAttempts: number;
  gradeOfRecord: number | null;
  examHref: string;
}) {
  const pending = result.status === "pending";
  const left = Math.max(0, maxAttempts - attemptsUsed);
  return (
    <Card>
      <ResultFocus targetId="result-title" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="result-title" tabIndex={-1} className="font-sans text-lg font-medium text-ink focus:outline-none">
          Submitted
        </h2>
        {pending ? (
          <Badge tone="warning">
            <ClockIcon /> Pending: not final yet
          </Badge>
        ) : (
          <Badge tone="success">
            <CheckIcon /> Final
          </Badge>
        )}
      </div>

      <div className="mt-3">
        {result.legacy ? (
          <p className="font-display text-4xl tabular-nums text-ink">Grade: {result.percent}%</p>
        ) : pending ? (
          <>
            <p className="text-lg text-ink">
              {result.autoMax > 0 ? (
                <>
                  <span className="font-medium tabular-nums">
                    {result.autoPoints} of {result.autoMax}
                  </span>{" "}
                  auto-graded {result.autoMax === 1 ? "point" : "points"},{" "}
                  <span className="tabular-nums">{pts(result.pendingManualMax)}</span> more pending manual grading
                </>
              ) : (
                <>
                  Nothing in this exam is auto-graded. <span className="tabular-nums">{pts(result.pendingManualMax)}</span> pending manual grading
                </>
              )}
            </p>
            <p className="mt-2 text-sm text-muted">
              Waiting on your professor:{" "}
              {result.pending.map((p, i) => (
                <span key={p.questionId}>
                  {i > 0 && ", "}
                  <a href={`#question-${p.number}`} className="rounded-sm font-medium text-ink underline underline-offset-2 hover:no-underline focus-visible:focus-ring">
                    question {p.number}
                  </a>
                </span>
              ))}
              . This score will change once they grade it.
            </p>
          </>
        ) : (
          <p className="font-display text-4xl tabular-nums text-ink">
            {result.totalPoints} of {pts(result.totalMax)}
            {result.percent !== null && <span className="ml-2 text-xl text-muted">({result.percent}%)</span>}
          </p>
        )}
      </div>

      {feedback && (
        <div className="mt-4 border-t border-hairline pt-4">
          <p className="text-xs font-medium text-muted">Feedback from your professor</p>
          <p className="mt-1 whitespace-pre-wrap text-[15px] text-body">{feedback}</p>
        </div>
      )}

      <div className="mt-4 space-y-3 border-t border-hairline pt-4">
        <p className="text-sm text-body">
          You&apos;ve used <span className="font-medium tabular-nums">{attemptsUsed} of {maxAttempts}</span> attempts.{" "}
          {left > 0
            ? `You have ${left} left. Your grade of record is your highest final attempt, so another try can only raise it.`
            : "That was your last attempt."}
        </p>
        {gradeOfRecord !== null && <p className="text-sm text-muted">Your grade of record so far: {gradeOfRecord}%.</p>}
        {left > 0 && (
          <Link href={examHref} className={buttonClassName("secondary", false, "md", "min-h-11 w-full sm:w-auto")}>
            Go to the exam page to try again
          </Link>
        )}
      </div>
    </Card>
  );
}
