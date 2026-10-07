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
  it("requires a correct answer for multiple choice and true/false, within the options", () => {
    const err = (t: "multiple_choice" | "true_false", over: object) => {
      const r = normalizeQuestionFields(t, { ...input, ...over });
      return r.ok ? null : r.error;
    };
    expect(err("multiple_choice", { correctOption: null })).toMatch(/Mark the correct/);
    expect(err("multiple_choice", { correctOption: 2 })).toMatch(/one of the options/);
    expect(err("multiple_choice", { optionsEs: ["a"], optionsEn: ["a"] })).toMatch(/at least 2/);
    expect(err("multiple_choice", { optionsEs: [], optionsEn: [] })).toMatch(/Add the answer options/);
    expect(err("true_false", { correctOption: null })).toMatch(/true or false/);
    // one language may still be empty while drafting, if the key fits the other
    expect(err("multiple_choice", { optionsEn: [] })).toBeNull();
  });
  it("carries a weight only when given, and caps blanks", () => {
    const r = normalizeQuestionFields("short_essay", { ...input, points: 3 });
    expect(r.ok && r.columns.points).toBe(3);
    const none = normalizeQuestionFields("short_essay", input);
    expect(none.ok && "points" in none.columns).toBe(false);
    const many = "{{blank}}".repeat(21);
    expect(normalizeQuestionFields("fill_in_the_blank", { ...input, promptEs: many }).ok).toBe(false);
  });
  it("text types drop options and key, keep reference answers", () => {
    for (const t of ["fill_in_the_blank", "short_essay"] as const) {
      const r = normalizeQuestionFields(t, input);
      expect(r.ok && r.columns).toMatchObject({ optionsEs: null, correctOption: null, referenceAnswerEs: "r" });
    }
  });
});
