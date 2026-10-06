import { describe, expect, it } from "vitest";
import { validateAnswers, type AnswerQuestion } from "./answers";

const Q1 = "11111111-1111-4111-8111-111111111111";
const Q2 = "22222222-2222-4222-8222-222222222222";
const Q3 = "33333333-3333-4333-8333-333333333333";
const Q4 = "44444444-4444-4444-8444-444444444444";
const questions: AnswerQuestion[] = [
  { id: Q1, type: "multiple_choice", optionsEs: ["a", "b", "c"], optionsEn: ["a", "b"] },
  { id: Q2, type: "true_false", optionsEs: null, optionsEn: null },
  { id: Q3, type: "fill_in_the_blank", optionsEs: null, optionsEn: null },
  { id: Q4, type: "short_essay", optionsEs: null, optionsEn: null },
];
const full = [
  { questionId: Q1, selectedOption: 1 },
  { questionId: Q2, selectedOption: 0 },
  { questionId: Q3, answerText: " x " },
  { questionId: Q4, answerText: "essay" },
];

describe("validateAnswers", () => {
  it("accepts a complete set and trims text", () => {
    const r = validateAnswers(questions, full, "es", true);
    expect(r.ok && r.answers.find((a) => a.questionId === Q3)?.answerText).toBe("x");
  });
  it("final submit requires every question; autosave does not", () => {
    expect(validateAnswers(questions, full.slice(0, 2), "es", true).ok).toBe(false);
    const r = validateAnswers(questions, full.slice(0, 2), "es", false);
    expect(r.ok && r.unansweredQuestionIds).toEqual([Q3, Q4]);
  });
  it("rejects unknown/duplicate questions and wrong-shaped answers", () => {
    expect(validateAnswers(questions, [{ questionId: "55555555-5555-4555-8555-555555555555", selectedOption: 0 }], "es", false).ok).toBe(false);
    expect(validateAnswers(questions, [full[0], full[0]], "es", false).ok).toBe(false);
    expect(validateAnswers(questions, [{ questionId: Q1, answerText: "a" }], "es", false).ok).toBe(false);
    expect(validateAnswers(questions, [{ questionId: Q3, selectedOption: 0 }], "es", false).ok).toBe(false);
  });
  it("bounds the chosen position by the language's option count", () => {
    expect(validateAnswers(questions, [{ questionId: Q1, selectedOption: 2 }], "es", false).ok).toBe(true);
    expect(validateAnswers(questions, [{ questionId: Q1, selectedOption: 2 }], "en", false).ok).toBe(false);
    expect(validateAnswers(questions, [{ questionId: Q2, selectedOption: 2 }], "es", false).ok).toBe(false);
  });
  it("treats blank text as unanswered and caps length per type", () => {
    const r = validateAnswers(questions, [{ questionId: Q3, answerText: "   " }], "es", false);
    expect(r.ok && r.answers).toEqual([]);
    expect(validateAnswers(questions, [{ questionId: Q3, answerText: "x".repeat(501) }], "es", false).ok).toBe(false);
    expect(validateAnswers(questions, [{ questionId: Q4, answerText: "x".repeat(501) }], "es", false).ok).toBe(true);
  });
});
