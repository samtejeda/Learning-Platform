import { describe, expect, it } from "vitest";
import {
  comprehensionProblems,
  deriveComprehensionState,
  isBlankQuestion,
  slotForAttempt,
  usableSlots,
  type ComprehensionQuestionRow,
} from "./comprehension";

const complete = (slot: number, over: Partial<ComprehensionQuestionRow> = {}): ComprehensionQuestionRow => ({
  slot,
  promptEs: "Question 1 (es)",
  promptEn: "Question 1 (en)",
  optionsEs: ["A", "B", "C"],
  optionsEn: ["A", "B", "C"],
  correctOption: 1,
  ...over,
});

describe("comprehensionProblems (the enabled gate)", () => {
  it("passes with one complete question", () => {
    expect(comprehensionProblems([complete(1)])).toEqual([]);
  });
  it("passes with two complete questions", () => {
    expect(comprehensionProblems([complete(1), complete(2)])).toEqual([]);
  });
  it("requires slot 1", () => {
    expect(comprehensionProblems([])).toEqual([{ slot: 1, message: "Add the first question." }]);
    expect(comprehensionProblems([complete(2)])[0]).toEqual({ slot: 1, message: "Add the first question." });
  });
  it("requires both languages for the prompt", () => {
    const p = comprehensionProblems([complete(1, { promptEn: "  " })]);
    expect(p.map((x) => x.message)).toEqual(["Add the English question."]);
    const q = comprehensionProblems([complete(1, { promptEs: null })]);
    expect(q.map((x) => x.message)).toEqual(["Add the Spanish question."]);
  });
  it("needs 3–6 non-empty options per language, equal counts", () => {
    expect(comprehensionProblems([complete(1, { optionsEs: ["A", "B"], optionsEn: ["A", "B"] })]).length).toBeGreaterThan(0);
    expect(comprehensionProblems([complete(1, { optionsEs: ["A", "B", "C", "D", "E", "F", "G"], optionsEn: ["A", "B", "C", "D", "E", "F", "G"] })]).length).toBeGreaterThan(0);
    expect(comprehensionProblems([complete(1, { optionsEn: ["A", "B", "C", "D"] })]).map((x) => x.message)).toContain(
      "Spanish and English must have the same number of options.",
    );
    expect(comprehensionProblems([complete(1, { optionsEs: ["A", " ", "C"] })]).map((x) => x.message)).toContain(
      "Spanish options: 3–6, none empty.",
    );
  });
  it("needs a key within the options", () => {
    for (const correctOption of [null, -1, 3, 9]) {
      expect(comprehensionProblems([complete(1, { correctOption })]).map((x) => x.message)).toContain(
        "Mark which option is the correct answer.",
      );
    }
    expect(comprehensionProblems([complete(1, { correctOption: 0 })])).toEqual([]);
    expect(comprehensionProblems([complete(1, { correctOption: 2 })])).toEqual([]);
  });
  it("ignores a blank slot 2 but rejects a half-written one", () => {
    const blank2 = complete(2, { promptEs: null, promptEn: null, optionsEs: [], optionsEn: [], correctOption: null });
    expect(comprehensionProblems([complete(1), blank2])).toEqual([]);
    const half = complete(2, { promptEn: null });
    expect(comprehensionProblems([complete(1), half]).map((x) => x.slot)).toEqual([2]);
  });
  it("does not quote content in messages", () => {
    const msgs = comprehensionProblems([complete(1, { promptEs: "SECRET WORDING", optionsEn: ["x"] })]).map((x) => x.message).join(" ");
    expect(msgs).not.toContain("SECRET WORDING");
  });
});

describe("blank + usable slots", () => {
  it("detects a fully blank question", () => {
    expect(isBlankQuestion({ promptEs: null, promptEn: " ", optionsEs: null, optionsEn: [], correctOption: null })).toBe(true);
    expect(isBlankQuestion({ promptEs: "x", promptEn: null, optionsEs: [], optionsEn: [], correctOption: null })).toBe(false);
    expect(isBlankQuestion({ promptEs: null, promptEn: null, optionsEs: [], optionsEn: [], correctOption: 0 })).toBe(false);
  });
  it("lists only non-blank slots", () => {
    const blank2 = complete(2, { promptEs: null, promptEn: null, optionsEs: [], optionsEn: [], correctOption: null });
    expect(usableSlots([complete(1), blank2])).toEqual([1]);
    expect(usableSlots([complete(1), complete(2)])).toEqual([1, 2]);
    expect(usableSlots([])).toEqual([]);
  });
});

describe("slotForAttempt", () => {
  it("attempt 1 is always slot 1", () => {
    expect(slotForAttempt([1, 2], 1)).toBe(1);
    expect(slotForAttempt([1], 1)).toBe(1);
  });
  it("attempt 2 is slot 2 when it exists, else slot 1 again", () => {
    expect(slotForAttempt([1, 2], 2)).toBe(2);
    expect(slotForAttempt([1], 2)).toBe(1);
  });
});

describe("deriveComprehensionState", () => {
  it("starts open with two attempts", () => {
    expect(deriveComprehensionState([])).toEqual({ status: "open", attemptsUsed: 0, attemptsRemaining: 2, nextAttempt: 1 });
  });
  it("passes on a first-attempt success", () => {
    expect(deriveComprehensionState([{ attemptNumber: 1, correct: true }])).toEqual({
      status: "passed", attemptsUsed: 1, attemptsRemaining: 0, nextAttempt: null,
    });
  });
  it("retries after one failure", () => {
    expect(deriveComprehensionState([{ attemptNumber: 1, correct: false }])).toEqual({
      status: "retry", attemptsUsed: 1, attemptsRemaining: 1, nextAttempt: 2,
    });
  });
  it("passes on a second-attempt success", () => {
    expect(
      deriveComprehensionState([{ attemptNumber: 1, correct: false }, { attemptNumber: 2, correct: true }]).status,
    ).toBe("passed");
  });
  it("blocks after two failures", () => {
    expect(
      deriveComprehensionState([{ attemptNumber: 1, correct: false }, { attemptNumber: 2, correct: false }]),
    ).toEqual({ status: "blocked", attemptsUsed: 2, attemptsRemaining: 0, nextAttempt: null });
  });
});
