import type { QuestionScore } from "@/lib/exams/scoring";
import { CheckIcon, ClockIcon, CrossIcon, DashIcon } from "./status-icons";

const pts = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;

/** Right / wrong / waiting for one question: icon + word + points, never colour alone. */
export function QuestionOutcome({ outcome }: { outcome: Pick<QuestionScore, "state" | "points" | "maxPoints"> }) {
  const { state, points, maxPoints } = outcome;
  const view =
    state === "correct"
      ? { icon: <span className="text-success-strong"><CheckIcon /></span>, word: "Correct", detail: `${points} of ${maxPoints}` }
      : state === "incorrect"
        ? { icon: <span className="text-error"><CrossIcon /></span>, word: "Incorrect", detail: `0 of ${maxPoints}` }
        : state === "unanswered"
          ? { icon: <span className="text-muted"><DashIcon /></span>, word: "Not answered", detail: `0 of ${maxPoints}` }
          : state === "awaiting"
            ? { icon: <span className="text-warning-strong"><ClockIcon /></span>, word: "Waiting for your professor", detail: pts(maxPoints) }
            : { icon: <span className="text-success-strong"><CheckIcon /></span>, word: "Graded", detail: `${points} of ${maxPoints}` };
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-ink">
      {view.icon}
      <span>{view.word}</span>
      <span className="font-normal text-muted">· {view.detail}</span>
    </p>
  );
}
