import { BLANK_TOKEN, countBlanks, MAX_BLANKS } from "./blanks";
import { MC_MIN_OPTIONS } from "./limits";
import type { QuestionFieldsInput } from "@/lib/validation/exams";

// Pure: shape a professor's question input by the question's type so a
// question can never carry fields its type doesn't use (e.g. an options
// list on an essay, or a grading guide on a multiple-choice question).

export type QuestionType = "multiple_choice" | "true_false" | "fill_in_the_blank" | "short_essay";

export type QuestionColumns = {
  promptEs: string | null;
  promptEn: string | null;
  optionsEs: string[] | null;
  optionsEn: string[] | null;
  correctOption: number | null;
  referenceAnswerEs: string | null;
  referenceAnswerEn: string | null;
  /** Present only when the caller supplied a weight (else unchanged / DB default). */
  points?: number;
};

export function normalizeQuestionFields(
  type: QuestionType,
  f: QuestionFieldsInput,
): { ok: true; columns: QuestionColumns } | { ok: false; error: string } {
  // The blank marker belongs to fill-in-the-blank prompts only. Rejected (not
  // stripped) so a professor's text is never silently changed.
  if (type !== "fill_in_the_blank" && ((f.promptEs ?? "").includes(BLANK_TOKEN) || (f.promptEn ?? "").includes(BLANK_TOKEN))) {
    return { ok: false, error: "The blank marker can only be used in fill-in-the-blank questions." };
  }
  const base = { promptEs: f.promptEs, promptEn: f.promptEn, ...(f.points !== undefined ? { points: f.points } : {}) };
  switch (type) {
    case "multiple_choice": {
      // Auto-scored: a correct answer is REQUIRED, and must be one of the options.
      const lists = [f.optionsEs, f.optionsEn].filter((l) => l.length > 0);
      if (lists.length === 0) return { ok: false, error: "Add the answer options and mark the correct one." };
      if (lists.some((l) => l.length < MC_MIN_OPTIONS)) {
        return { ok: false, error: `Multiple choice needs at least ${MC_MIN_OPTIONS} options.` };
      }
      // A key is a position, so both languages must list the same number of options
      // (one may be empty while drafting).
      if (f.optionsEs.length > 0 && f.optionsEn.length > 0 && f.optionsEs.length !== f.optionsEn.length) {
        return { ok: false, error: "Spanish and English need the same number of options, so the correct answer is the same option in both." };
      }
      if (f.correctOption === null) return { ok: false, error: "Mark the correct answer." };
      if (lists.some((l) => f.correctOption! >= l.length)) {
        return { ok: false, error: "The correct answer must be one of the options." };
      }
      return {
        ok: true,
        columns: {
          ...base,
          optionsEs: f.optionsEs,
          optionsEn: f.optionsEn,
          correctOption: f.correctOption,
          referenceAnswerEs: null,
          referenceAnswerEn: null,
        },
      };
    }
    case "true_false":
      if (f.correctOption === null) return { ok: false, error: "Mark whether the correct answer is true or false." };
      if (f.correctOption > 1) {
        return { ok: false, error: "The key for true/false must be true or false." };
      }
      return {
        ok: true,
        columns: {
          ...base,
          optionsEs: null,
          optionsEn: null,
          correctOption: f.correctOption,
          referenceAnswerEs: null,
          referenceAnswerEn: null,
        },
      };
    default:
      if (type === "fill_in_the_blank" && (countBlanks(f.promptEs) > MAX_BLANKS || countBlanks(f.promptEn) > MAX_BLANKS)) {
        return { ok: false, error: `At most ${MAX_BLANKS} blanks per question.` };
      }
      return {
        ok: true,
        columns: {
          ...base,
          optionsEs: null,
          optionsEn: null,
          correctOption: null,
          referenceAnswerEs: f.referenceAnswerEs,
          referenceAnswerEn: f.referenceAnswerEn,
        },
      };
  }
}
