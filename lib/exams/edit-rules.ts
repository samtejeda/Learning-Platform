import { countBlanks } from "./blanks";
import { asStringArray } from "./language";

// Pure rules for editing an exam once students have started it. Answers are
// stored by option POSITION, so anything that moves, adds or removes a
// position would silently change what a saved answer means. Wording fixes
// and key corrections never do, so they are always allowed.

export type AttemptBlock =
  | "delete_question"
  | "reorder_questions"
  | "add_question"
  | "option_count"
  | "option_order"
  | "blank_count";

export const ATTEMPT_BLOCK_MESSAGES: Record<AttemptBlock, string> = {
  delete_question:
    "Students have started this exam, so questions can't be deleted (their answers would be lost). You can still fix wording and the answer key.",
  reorder_questions: "Students have started this exam, so questions can't be reordered. You can still fix wording and the answer key.",
  add_question:
    "Students have started this exam, so questions can't be added (existing attempts wouldn't include them). You can still fix wording and the answer key.",
  option_count:
    "Students have started this exam, so the number of options can't change (their saved answers point to option positions). You can still fix option wording and the key.",
  option_order:
    "Students have started this exam, so the order of options can't change (their saved answers point to option positions). You can still fix option wording and the key.",
  blank_count:
    "Students have started this exam, so the number of blanks can't change (their saved answers are kept per blank). You can still fix the wording around the blanks.",
};

/** True when `next` holds exactly the same items as `prev` in a different order. */
function isPureReorder(prev: string[], next: string[]): boolean {
  if (prev.length !== next.length) return false;
  if (prev.every((v, i) => v === next[i])) return false;
  const a = [...prev].map((s) => s.trim()).sort();
  const b = [...next].map((s) => s.trim()).sort();
  return a.every((v, i) => v === b[i]);
}

/**
 * Check a multiple-choice edit against the stored options when attempts
 * exist. A reorder is only detectable when the same options reappear in a new
 * order; a hand-rewritten reorder looks like a wording change and cannot be
 * told apart (documented limit).
 */
export function optionEditBlock(
  stored: { optionsEs: unknown; optionsEn: unknown },
  next: { optionsEs: string[] | null; optionsEn: string[] | null },
): AttemptBlock | null {
  for (const [prevRaw, nextArr] of [
    [stored.optionsEs, next.optionsEs],
    [stored.optionsEn, next.optionsEn],
  ] as const) {
    const prev = asStringArray(prevRaw);
    const cur = nextArr ?? [];
    if (prev.length !== cur.length) return "option_count";
    if (isPureReorder(prev, cur)) return "option_order";
  }
  return null;
}

/** With attempts, a fill-in-the-blank prompt must keep its number of blanks in each language. */
export function blankEditBlock(
  stored: { promptEs: string | null; promptEn: string | null },
  next: { promptEs: string | null; promptEn: string | null },
): AttemptBlock | null {
  return countBlanks(stored.promptEs) !== countBlanks(next.promptEs) ||
    countBlanks(stored.promptEn) !== countBlanks(next.promptEn)
    ? "blank_count"
    : null;
}
