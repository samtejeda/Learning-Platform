// Pure view logic for the student's comprehension card: how a check response
// becomes the next card state, how API errors become plain sentences, and the
// attempts wording. The server decides everything (which question, whether it
// was right, how many attempts remain); this only renders what it is given.
// No React and no key anywhere: the client never has one.

import type { ComprehensionStatus } from "@/lib/lectures/comprehension";

export type CardQuestion = {
  es: { prompt: string; options: string[] };
  en: { prompt: string; options: string[] };
};

export type CardState = {
  status: ComprehensionStatus;
  attemptsRemaining: number;
  /** The question to answer now; null when passed or blocked. */
  question: CardQuestion | null;
  /** The answer just given was wrong (drives the "not quite" notice). */
  lastWrong: boolean;
  /** The state came from an answer given in this session (vs. loaded from the server). */
  answeredNow: boolean;
};

export type CheckResponse = {
  correct: boolean;
  status: ComprehensionStatus;
  attemptsRemaining: number;
  nextQuestion: CardQuestion | null;
};

const STATUSES: readonly string[] = ["open", "retry", "passed", "blocked"];

function isLangBlock(v: unknown): v is { prompt: string; options: string[] } {
  if (typeof v !== "object" || v === null) return false;
  const o = v as { prompt?: unknown; options?: unknown };
  return typeof o.prompt === "string" && Array.isArray(o.options) && o.options.every((x) => typeof x === "string");
}

function isQuestion(v: unknown): v is CardQuestion {
  return typeof v === "object" && v !== null && isLangBlock((v as CardQuestion).es) && isLangBlock((v as CardQuestion).en);
}

/** Validate the route's JSON rather than trusting its shape. */
export function parseCheckResponse(json: unknown): CheckResponse | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  if (typeof o.correct !== "boolean") return null;
  if (typeof o.status !== "string" || !STATUSES.includes(o.status)) return null;
  if (typeof o.attemptsRemaining !== "number") return null;
  if (o.nextQuestion !== null && !isQuestion(o.nextQuestion)) return null;
  return {
    correct: o.correct,
    status: o.status as ComprehensionStatus,
    attemptsRemaining: o.attemptsRemaining,
    nextQuestion: o.nextQuestion as CardQuestion | null,
  };
}

export function applyResponse(r: CheckResponse): CardState {
  return {
    status: r.status,
    attemptsRemaining: r.attemptsRemaining,
    question: r.status === "passed" || r.status === "blocked" ? null : r.nextQuestion,
    lastWrong: !r.correct,
    answeredNow: true,
  };
}

export function attemptsLeftText(n: number): string {
  return n === 1 ? "You have 1 attempt left." : `You have ${n} attempts left.`;
}

/** What a failed check tells the student; `resync` asks the page to reload server state. */
export function checkErrorMessage(status: number, code: string | null): { message: string; resync: boolean } {
  if (status === 429) return { message: "That was a lot of tries at once. Wait a moment and try again.", resync: false };
  if (status === 409) {
    switch (code) {
      case "not_completed":
        return { message: "Finish watching the lecture before answering.", resync: true };
      case "already_passed":
        return { message: "You have already answered this correctly.", resync: true };
      case "no_attempts_left":
        return { message: "There are no attempts left on this question.", resync: true };
      default:
        return { message: "That answer was already sent.", resync: true };
    }
  }
  if (status === 404) return { message: "This question isn't available right now.", resync: true };
  return { message: "We couldn't check your answer. Please try again.", resync: false };
}
