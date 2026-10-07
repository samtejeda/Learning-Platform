import { countBlanks } from "./blanks";
import { asStringArray, type ContentLanguage } from "./language";
import { ESSAY_ANSWER_MAX_LENGTH, FILL_ANSWER_MAX_LENGTH } from "./limits";

// Pure validation of a student's answers against the exam's real questions.
// The client's claims (which ids exist, which type a question is, how many
// options there are) are never trusted: everything is re-derived from the
// server-side question rows.

export type AnswerQuestion = {
  id: string;
  type: "multiple_choice" | "true_false" | "fill_in_the_blank" | "short_essay";
  optionsEs: unknown;
  optionsEn: unknown;
  promptEs: string | null;
  promptEn: string | null;
};

export type RawAnswer = { questionId: string; selectedOption?: number; answerText?: string; blanks?: string[] };

export type CleanAnswer =
  | { questionId: string; selectedOption: number; answerText: null; blankAnswers: null }
  | { questionId: string; selectedOption: null; answerText: string; blankAnswers: null }
  | { questionId: string; selectedOption: null; answerText: null; blankAnswers: string[] };

export type AnswersResult =
  | { ok: true; answers: CleanAnswer[]; unansweredQuestionIds: string[] }
  | { ok: false; error: string };

/**
 * `requireComplete`: final submit needs every question answered. Autosave
 * and lazy close of an expired attempt accept partial sets. Blank text is
 * treated as "unanswered" (dropped), never stored. A multi-blank question
 * with some blanks empty is saved on autosave but counts as unanswered for
 * the final submit.
 */
export function validateAnswers(
  questions: AnswerQuestion[],
  raw: RawAnswer[],
  language: ContentLanguage,
  requireComplete: boolean,
): AnswersResult {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const seen = new Set<string>();
  const clean: CleanAnswer[] = [];
  const incomplete = new Set<string>(); // saved (partially) but not fully answered

  for (const a of raw) {
    const q = byId.get(a.questionId);
    if (!q) return { ok: false, error: "An answer doesn't belong to this exam." };
    if (seen.has(a.questionId)) return { ok: false, error: "A question was answered twice." };
    seen.add(a.questionId);

    if (q.type === "multiple_choice" || q.type === "true_false") {
      if (a.answerText !== undefined) return { ok: false, error: "Invalid answer." };
      if (a.selectedOption === undefined) continue; // unanswered
      const count =
        q.type === "true_false"
          ? 2
          : asStringArray(language === "es" ? q.optionsEs : q.optionsEn).length;
      if (!Number.isInteger(a.selectedOption) || a.selectedOption < 0 || a.selectedOption >= count) {
        return { ok: false, error: "Invalid answer." };
      }
      clean.push({ questionId: q.id, selectedOption: a.selectedOption, answerText: null, blankAnswers: null });
    } else if (q.type === "fill_in_the_blank" && countBlanks(language === "es" ? q.promptEs : q.promptEn) > 0) {
      // One answer per blank, in the attempt's language; blanks are never trusted by count.
      const n = countBlanks(language === "es" ? q.promptEs : q.promptEn);
      if (a.selectedOption !== undefined || a.answerText !== undefined) return { ok: false, error: "Invalid answer." };
      if (a.blanks === undefined) continue;
      if (a.blanks.length !== n) return { ok: false, error: "Invalid answer." };
      const blanks = a.blanks.map((b) => b.trim());
      if (blanks.some((b) => b.length > FILL_ANSWER_MAX_LENGTH)) return { ok: false, error: "An answer is too long." };
      if (blanks.every((b) => b.length === 0)) continue; // unanswered
      if (blanks.some((b) => b.length === 0)) incomplete.add(q.id);
      clean.push({ questionId: q.id, selectedOption: null, answerText: null, blankAnswers: blanks });
    } else {
      if (a.selectedOption !== undefined || a.blanks !== undefined) return { ok: false, error: "Invalid answer." };
      const text = (a.answerText ?? "").trim();
      if (text.length === 0) continue; // unanswered
      const max = q.type === "short_essay" ? ESSAY_ANSWER_MAX_LENGTH : FILL_ANSWER_MAX_LENGTH;
      if (text.length > max) return { ok: false, error: "An answer is too long." };
      clean.push({ questionId: q.id, selectedOption: null, answerText: text, blankAnswers: null });
    }
  }

  const answered = new Set(clean.filter((c) => !incomplete.has(c.questionId)).map((c) => c.questionId));
  const unansweredQuestionIds = questions.filter((q) => !answered.has(q.id)).map((q) => q.id);
  if (requireComplete && unansweredQuestionIds.length > 0) {
    return { ok: false, error: `Answer every question before submitting (${unansweredQuestionIds.length} left).` };
  }
  return { ok: true, answers: clean, unansweredQuestionIds };
}
