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
};

export function normalizeQuestionFields(
  type: QuestionType,
  f: QuestionFieldsInput,
): { ok: true; columns: QuestionColumns } | { ok: false; error: string } {
  const base = { promptEs: f.promptEs, promptEn: f.promptEn };
  switch (type) {
    case "multiple_choice":
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
    case "true_false":
      if (f.correctOption !== null && f.correctOption > 1) {
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
