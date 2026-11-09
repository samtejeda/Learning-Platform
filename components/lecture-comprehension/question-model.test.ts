import { describe, expect, it } from "vitest";
import {
  addOptionRow,
  draftFromSaved,
  emptySlot,
  filledRows,
  isBlankSlot,
  previewQuestions,
  removeOptionRow,
  sameFields,
  saveBlockers,
  toFormFields,
  type ComprehensionDraft,
} from "./question-model";

const slotWith = (rows: [string, string][], correct: number | null, p: [string, string] = ["", ""]) => ({
  promptEs: p[0],
  promptEn: p[1],
  options: rows.map(([es, en]) => ({ es, en })),
  correct,
});
const draft = (a = emptySlot(), b = emptySlot()): ComprehensionDraft => [a, b];

describe("draft <-> saved", () => {
  it("starts empty slots with three rows", () => {
    expect(emptySlot().options).toHaveLength(3);
    expect(draftFromSaved([])[1].options).toHaveLength(3);
  });
  it("pairs saved options by position and keeps the key", () => {
    const d = draftFromSaved([
      { slot: 1, promptEs: "P es", promptEn: "P en", optionsEs: ["a", "b", "c", "d"], optionsEn: ["A", "B", "C", "D"], correctOption: 2 },
    ]);
    expect(d[0].options[3]).toEqual({ es: "d", en: "D" });
    expect(d[0].correct).toBe(2);
    expect(isBlankSlot(d[1])).toBe(true);
  });
});

describe("toFormFields", () => {
  it("uses the flat field names with one option per line", () => {
    const f = toFormFields(draft(slotWith([["a", "A"], ["b", "B"], ["c", "C"]], 1, ["Question 1", "Question 1"])));
    expect(f.q1PromptEs).toBe("Question 1");
    expect(f.q1OptionsEs).toBe("a\nb\nc");
    expect(f.q1OptionsEn).toBe("A\nB\nC");
    expect(f.q1Correct).toBe("1");
    expect(f.q2OptionsEs).toBe("");
    expect(f.q2Correct).toBe("");
  });
  it("drops trailing empty rows but never a middle one", () => {
    const s = slotWith([["a", "A"], ["", ""], ["c", "C"], ["", ""]], 2);
    expect(filledRows(s)).toHaveLength(3);
    expect(toFormFields(draft(s)).q1OptionsEs).toBe("a\n\nc");
  });
  it("sends no key when it points past the filled rows", () => {
    expect(toFormFields(draft(slotWith([["a", "A"], ["", ""], ["", ""]], 2))).q1Correct).toBe("");
  });
});

describe("saveBlockers", () => {
  it("is empty for a complete slot and for an untouched one", () => {
    expect(saveBlockers(draft())).toEqual([]);
    expect(saveBlockers(draft(slotWith([["a", "A"], ["b", "B"], ["c", "C"]], 0)))).toEqual([]);
  });
  it("names a half-filled option and a middle gap", () => {
    expect(saveBlockers(draft(slotWith([["a", ""], ["b", "B"], ["c", "C"]], 0)))[0]).toMatch(/Question 1: fill in option 1 in both languages/);
    expect(saveBlockers(draft(slotWith([["a", "A"], ["", ""], ["c", "C"]], 0)))[0]).toMatch(/option 2 is empty/);
  });
  it("blocks a key marked on an empty option", () => {
    expect(saveBlockers(draft(emptySlot(), slotWith([["a", "A"], ["", ""], ["", ""]], 2)))[0]).toMatch(/Question 2: the correct answer/);
  });
  it("does not block missing wording (that is the checklist's job)", () => {
    expect(saveBlockers(draft(slotWith([["a", "A"], ["b", "B"], ["c", "C"]], null)))).toEqual([]);
  });
});

describe("row operations", () => {
  const four = slotWith([["a", "A"], ["b", "B"], ["c", "C"], ["d", "D"]], 2);
  it("removing a row above the key moves the key up; removing the key clears it", () => {
    expect(removeOptionRow(four, 0).correct).toBe(1);
    expect(removeOptionRow(four, 2).correct).toBeNull();
    expect(removeOptionRow(four, 3).correct).toBe(2);
  });
  it("never goes below three or above six rows", () => {
    const three = slotWith([["a", "A"], ["b", "B"], ["c", "C"]], 0);
    expect(removeOptionRow(three, 0)).toBe(three);
    let s = three;
    for (let i = 0; i < 10; i++) s = addOptionRow(s);
    expect(s.options).toHaveLength(6);
  });
});

describe("sameFields / previewQuestions", () => {
  it("ignores whitespace and trailing empty rows", () => {
    const a = draft(slotWith([["a", "A"], ["b", "B"], ["c", "C"]], 0));
    const b = draft(slotWith([[" a ", "A"], ["b", "B"], ["c", "C"], ["", ""]], 0));
    expect(sameFields(a, b)).toBe(true);
    expect(sameFields(a, draft(slotWith([["a", "A"], ["b", "B"], ["c", "C"]], 1)))).toBe(false);
  });
  it("previews only written slots and carries no key", () => {
    const p = previewQuestions(draft(slotWith([["a", "A"], ["b", "B"], ["c", "C"]], 1, ["Q1", "Q1"])));
    expect(p).toHaveLength(1);
    expect(p[0].slot).toBe(1);
    expect(JSON.stringify(p)).not.toMatch(/correct/i);
  });
});
