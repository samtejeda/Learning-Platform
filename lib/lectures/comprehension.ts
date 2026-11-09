import { asStringArray } from "@/lib/exams/language";
import { MC_MAX_OPTIONS, OPTION_MAX_LENGTH, PROMPT_MAX_LENGTH } from "@/lib/exams/limits";

// Rules for the end-of-lecture comprehension question (pure, unit-tested).
//
// Sam's model (2026-11-06, refined 2026-11-09):
//  - per LECTURE, with a professor on/off toggle (turning it off keeps the text)
//  - slot 1 is required, slot 2 is optional; both are multiple choice
//  - bilingual es/en; drafts may be incomplete, but an ENABLED question must be
//    complete in both languages (and re-checked on every edit and at publish)
//  - the key is a POSITION, never text
//  - two attempts total: attempt 1 asks slot 1; attempt 2 asks slot 2 if the
//    professor wrote one, otherwise slot 1 again
// Messages are interface text; they never quote the professor's wording.

export const COMPREHENSION_SLOTS = [1, 2] as const;
export type ComprehensionSlot = (typeof COMPREHENSION_SLOTS)[number];

export const COMPREHENSION_MAX_ATTEMPTS = 2;

/** Three, not exams' two: with a retry of the same question, two options
 * would make the second attempt a guaranteed pass. */
export const COMPREHENSION_MIN_OPTIONS = 3;
export const COMPREHENSION_MAX_OPTIONS = MC_MAX_OPTIONS;
export { OPTION_MAX_LENGTH, PROMPT_MAX_LENGTH };

export type ComprehensionQuestionRow = {
  slot: number;
  promptEs: string | null;
  promptEn: string | null;
  optionsEs: unknown;
  optionsEn: unknown;
  correctOption: number | null;
};

export type ComprehensionProblem = {
  /** 1 or 2, or null for a lecture-level problem. */
  slot: number | null;
  message: string;
};

const blank = (v: string | null) => !v || v.trim().length === 0;

/** A slot with nothing in it at all. Such a row is deleted rather than stored. */
export function isBlankQuestion(q: Omit<ComprehensionQuestionRow, "slot">): boolean {
  return (
    blank(q.promptEs) &&
    blank(q.promptEn) &&
    asStringArray(q.optionsEs).length === 0 &&
    asStringArray(q.optionsEn).length === 0 &&
    q.correctOption === null
  );
}

/** Everything wrong with one question that is supposed to be complete. */
function incompleteReasons(q: ComprehensionQuestionRow): string[] {
  const out: string[] = [];
  if (blank(q.promptEs)) out.push("Add the Spanish question.");
  if (blank(q.promptEn)) out.push("Add the English question.");

  const es = asStringArray(q.optionsEs).map((o) => o.trim());
  const en = asStringArray(q.optionsEn).map((o) => o.trim());
  const range = `${COMPREHENSION_MIN_OPTIONS}–${COMPREHENSION_MAX_OPTIONS}`;
  if (es.length < COMPREHENSION_MIN_OPTIONS || es.length > COMPREHENSION_MAX_OPTIONS || es.some((o) => !o)) {
    out.push(`Spanish options: ${range}, none empty.`);
  }
  if (en.length < COMPREHENSION_MIN_OPTIONS || en.length > COMPREHENSION_MAX_OPTIONS || en.some((o) => !o)) {
    out.push(`English options: ${range}, none empty.`);
  }
  if (es.length !== en.length) out.push("Spanish and English must have the same number of options.");
  if (q.correctOption === null || q.correctOption < 0 || q.correctOption >= Math.min(es.length, en.length)) {
    out.push("Mark which option is the correct answer.");
  }
  return out;
}

/**
 * The gate for an ENABLED lecture question. Slot 1 must exist and be complete;
 * slot 2 may be absent/blank, but if the professor started it, it must be
 * complete too (no half questions).
 */
export function comprehensionProblems(questions: ComprehensionQuestionRow[]): ComprehensionProblem[] {
  const problems: ComprehensionProblem[] = [];
  const first = questions.find((q) => q.slot === 1);
  if (!first || isBlankQuestion(first)) {
    problems.push({ slot: 1, message: "Add the first question." });
  } else {
    for (const message of incompleteReasons(first)) problems.push({ slot: 1, message });
  }
  const second = questions.find((q) => q.slot === 2);
  if (second && !isBlankQuestion(second)) {
    for (const message of incompleteReasons(second)) problems.push({ slot: 2, message });
  }
  return problems;
}

/** Which slots a student can actually be asked (present and not blank). */
export function usableSlots(questions: ComprehensionQuestionRow[]): ComprehensionSlot[] {
  return COMPREHENSION_SLOTS.filter((s) => {
    const q = questions.find((x) => x.slot === s);
    return q !== undefined && !isBlankQuestion(q);
  });
}

/**
 * The question asked on a given attempt: attempt 1 is slot 1; attempt 2 is
 * slot 2 when the professor wrote one, otherwise slot 1 again.
 */
export function slotForAttempt(slots: readonly number[], attemptNumber: number): ComprehensionSlot {
  return attemptNumber >= 2 && slots.includes(2) ? 2 : 1;
}

export type ComprehensionStatus = "open" | "retry" | "passed" | "blocked";

export type ComprehensionState = {
  status: ComprehensionStatus;
  attemptsUsed: number;
  attemptsRemaining: number;
  /** The attempt number the next answer will count as, or null when none is left. */
  nextAttempt: 1 | 2 | null;
};

/**
 * Student state from their recorded attempts. "passed" once any attempt was
 * correct; "blocked" after the allowed attempts are all wrong (a professor
 * unlock, added later, is read separately and overrides this).
 */
export function deriveComprehensionState(
  attempts: readonly { attemptNumber: number; correct: boolean }[],
): ComprehensionState {
  const used = new Set(attempts.map((a) => a.attemptNumber)).size;
  if (attempts.some((a) => a.correct)) {
    return { status: "passed", attemptsUsed: used, attemptsRemaining: 0, nextAttempt: null };
  }
  if (used >= COMPREHENSION_MAX_ATTEMPTS) {
    return { status: "blocked", attemptsUsed: used, attemptsRemaining: 0, nextAttempt: null };
  }
  return {
    status: used === 0 ? "open" : "retry",
    attemptsUsed: used,
    attemptsRemaining: COMPREHENSION_MAX_ATTEMPTS - used,
    nextAttempt: (used + 1) as 1 | 2,
  };
}

// ─── Saving a draft ───────────────────────────────────────────────────────────

/** What the professor typed for one slot (already trimmed/parsed by zod). */
export type ComprehensionSlotInput = {
  promptEs: string | null;
  promptEn: string | null;
  optionsEs: string[];
  optionsEn: string[];
  correctOption: number | null;
};

export type NormalizedSlot =
  | { kind: "blank" }
  | {
      kind: "question";
      columns: {
        promptEs: string | null;
        promptEn: string | null;
        optionsEs: string[] | null;
        optionsEn: string[] | null;
        correctOption: number | null;
      };
    };

/**
 * Shape one slot for storage. Drafts may be incomplete, but the structural
 * rules that protect the positional key always hold: both languages list the
 * same number of options (when both are filled in), and a key must point at an
 * option that exists. A fully empty slot is "blank" (the row is removed).
 * Completeness (3–6 options, both languages, a key) is the enabled gate's job.
 */
export function normalizeSlot(slot: number, f: ComprehensionSlotInput): { ok: true; value: NormalizedSlot } | { ok: false; error: string } {
  if (isBlankQuestion(f)) return { ok: true, value: { kind: "blank" } };
  const where = `Question ${slot}`;
  if (f.optionsEs.length > 0 && f.optionsEn.length > 0 && f.optionsEs.length !== f.optionsEn.length) {
    return { ok: false, error: `${where}: Spanish and English need the same number of options, so the correct answer is the same option in both.` };
  }
  if (f.correctOption !== null) {
    const lists = [f.optionsEs, f.optionsEn].filter((l) => l.length > 0);
    if (lists.length === 0) return { ok: false, error: `${where}: add the options before choosing the correct answer.` };
    if (lists.some((l) => f.correctOption! >= l.length)) {
      return { ok: false, error: `${where}: the correct answer must be one of the options.` };
    }
  }
  return {
    ok: true,
    value: {
      kind: "question",
      columns: {
        promptEs: f.promptEs,
        promptEn: f.promptEn,
        optionsEs: f.optionsEs.length > 0 ? f.optionsEs : null,
        optionsEn: f.optionsEn.length > 0 ? f.optionsEn : null,
        correctOption: f.correctOption,
      },
    },
  };
}
