import { describe, expect, it } from "vitest";
import { normalizeQuestionFields } from "./question";
import { questionFieldsSchema } from "@/lib/validation/exams";

const input = questionFieldsSchema.parse({
  promptEs: "p", promptEn: "q", optionsEs: "a\nb", optionsEn: "a\nb", correctOption: "1",
  referenceAnswerEs: "r", referenceAnswerEn: "s",
});

describe("normalizeQuestionFields", () => {
  it("multiple choice keeps options and key, drops reference answers", () => {
    const r = normalizeQuestionFields("multiple_choice", input);
    expect(r.ok && r.columns).toMatchObject({ optionsEs: ["a", "b"], correctOption: 1, referenceAnswerEs: null });
  });
  it("true/false drops options and bounds the key", () => {
    const r = normalizeQuestionFields("true_false", { ...input, correctOption: 0 });
    expect(r.ok && r.columns.optionsEs).toBeNull();
    expect(normalizeQuestionFields("true_false", { ...input, correctOption: 2 }).ok).toBe(false);
  });
  it("text types drop options and key, keep reference answers", () => {
    for (const t of ["fill_in_the_blank", "short_essay"] as const) {
      const r = normalizeQuestionFields(t, input);
      expect(r.ok && r.columns).toMatchObject({ optionsEs: null, correctOption: null, referenceAnswerEs: "r" });
    }
  });
});
