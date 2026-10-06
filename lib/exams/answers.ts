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
};

export type RawAnswer = { questionId: string; selectedOption?: number; answerText?: string };

export type CleanAnswer =
  | { questionId: string; selectedOption: number; answerText: null }
  | { questionId: string; selectedOption: null; answerText: string };

export type AnswersResult =
  | { ok: true; answers: CleanAnswer[]; unansweredQuestionIds: string[] }
  | { ok: false; error: string };

/**
 * `requireComplete`: final submit needs every question answered. Autosave
 * and lazy close of an expired attempt accept partial sets. Blank text is
 * treated as "unanswered" (dropped), never stored.
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
      clean.push({ questionId: q.id, selectedOption: a.selectedOption, answerText: null });
    } else {
      if (a.selectedOption !== undefined) return { ok: false, error: "Invalid answer." };
      const text = (a.answerText ?? "").trim();
      if (text.length === 0) continue; // unanswered
      const max = q.type === "short_essay" ? ESSAY_ANSWER_MAX_LENGTH : FILL_ANSWER_MAX_LENGTH;
      if (text.length > max) return { ok: false, error: "An answer is too long." };
      clean.push({ questionId: q.id, selectedOption: null, answerText: text });
    }
  }

  const answered = new Set(clean.map((c) => c.questionId));
  const unansweredQuestionIds = questions.filter((q) => !answered.has(q.id)).map((q) => q.id);
  if (requireComplete && unansweredQuestionIds.length > 0) {
    return { ok: false, error: `Answer every question before submitting (${unansweredQuestionIds.length} left).` };
  }
  return { ok: true, answers: clean, unansweredQuestionIds };
}
