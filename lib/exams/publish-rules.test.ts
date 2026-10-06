import { describe, expect, it } from "vitest";
import { examPublishProblems, type PublishQuestion } from "./publish-rules";

const ok = { titleEs: "PLACEHOLDER es", titleEn: "PLACEHOLDER en" };
const mc = (over: Partial<PublishQuestion> = {}): PublishQuestion => ({
  type: "multiple_choice",
  promptEs: "p es",
  promptEn: "p en",
  optionsEs: ["a", "b"],
  optionsEn: ["a", "b"],
  correctOption: 1,
  ...over,
});
const essay = (over: Partial<PublishQuestion> = {}): PublishQuestion => ({
  type: "short_essay",
  promptEs: "p es",
  promptEn: "p en",
  optionsEs: null,
  optionsEn: null,
  correctOption: null,
  ...over,
});

describe("examPublishProblems", () => {
  it("passes a complete bilingual exam", () => {
    expect(examPublishProblems(ok, [mc(), essay(), { ...essay(), type: "true_false", correctOption: 0 }])).toEqual([]);
  });
  it("needs both titles and at least one question", () => {
    const p = examPublishProblems({ titleEs: "x", titleEn: "  " }, []);
    expect(p.map((x) => x.message)).toEqual(["Add an English title.", "Add at least one question."]);
  });
  it("needs both prompts on every question, numbering from 1", () => {
    const p = examPublishProblems(ok, [essay(), essay({ promptEn: null })]);
    expect(p).toEqual([{ question: 2, message: "Add the English prompt." }]);
  });
  it("requires matching, non-empty option lists and an in-range key", () => {
    expect(examPublishProblems(ok, [mc({ optionsEn: ["a", "b", "c"] })]).some((x) => /same number/.test(x.message))).toBe(true);
    expect(examPublishProblems(ok, [mc({ optionsEs: ["a"], optionsEn: ["a"] })]).length).toBeGreaterThan(0);
    expect(examPublishProblems(ok, [mc({ optionsEs: ["a", " "], optionsEn: ["a", "b"] })]).length).toBeGreaterThan(0);
    expect(examPublishProblems(ok, [mc({ correctOption: null })]).some((x) => /key/.test(x.message))).toBe(true);
    expect(examPublishProblems(ok, [mc({ correctOption: 2 })]).some((x) => /key/.test(x.message))).toBe(true);
  });
  it("requires a true/false key of 0 or 1 but no key for text types", () => {
    expect(examPublishProblems(ok, [{ ...essay(), type: "true_false", correctOption: null }]).length).toBe(1);
    expect(examPublishProblems(ok, [{ ...essay(), type: "true_false", correctOption: 2 }]).length).toBe(1);
    expect(examPublishProblems(ok, [{ ...essay(), type: "fill_in_the_blank" }])).toEqual([]);
  });
});
