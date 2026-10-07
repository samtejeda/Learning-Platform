import { describe, expect, it } from "vitest";
import {
  addOptionRow,
  changesScores,
  draftFromQuestion,
  emptyDraft,
  examTotals,
  removeOptionRow,
  saveBlockers,
  toFormFields,
  type SavedQuestion,
} from "./question-model";

const mc: SavedQuestion = {
  type: "multiple_choice",
  promptEs: "p",
  promptEn: "q",
  optionsEs: ["a", "b", "c"],
  optionsEn: ["a", "b", "c"],
  correctOption: 1,
  referenceAnswerEs: null,
  referenceAnswerEn: null,
  points: 2,
};

describe("question model", () => {
  it("needs a type first", () => {
    expect(saveBlockers(emptyDraft())).toEqual(["Choose what kind of question this is."]);
  });

  it("multiple choice can't save without a correct answer or with an empty option", () => {
    const d = { ...emptyDraft("multiple_choice"), options: [{ es: "a", en: "a" }, { es: "b", en: "" }] };
    const reasons = saveBlockers(d);
    expect(reasons).toContain("Fill in option 2 in both languages, or remove it.");
    expect(reasons).toContain("Choose the correct answer.");
    expect(saveBlockers({ ...d, options: [{ es: "a", en: "a" }, { es: "b", en: "b" }], correct: 0 })).toEqual([]);
  });

  it("true/false has no default and needs a choice", () => {
    expect(emptyDraft("true_false").correct).toBeNull();
    expect(saveBlockers(emptyDraft("true_false"))).toEqual(["Choose whether the correct answer is true or false."]);
    expect(saveBlockers({ ...emptyDraft("true_false"), correct: 0 })).toEqual([]);
  });

  it("blank and essay need no key; incomplete wording does not block a draft", () => {
    expect(saveBlockers(emptyDraft("fill_in_the_blank"))).toEqual([]);
    expect(saveBlockers(emptyDraft("short_essay"))).toEqual([]);
  });

  it("validates points", () => {
    expect(saveBlockers({ ...emptyDraft("short_essay"), points: "0" })).toHaveLength(1);
    expect(saveBlockers({ ...emptyDraft("short_essay"), points: "1.5" })).toHaveLength(1);
    expect(saveBlockers({ ...emptyDraft("short_essay"), points: "100" })).toEqual([]);
  });

  it("maps to the server's field names and only the fields the type needs", () => {
    const f = toFormFields(draftFromQuestion(mc));
    expect(f).toMatchObject({ type: "multiple_choice", optionsEs: "a\nb\nc", optionsEn: "a\nb\nc", correctOption: "1", points: "2" });
    expect(f.referenceAnswerEs).toBeUndefined();
    const essay = toFormFields({ ...emptyDraft("short_essay"), notesEs: "n" });
    expect(essay.optionsEs).toBeUndefined();
    expect(essay.correctOption).toBeUndefined();
    expect(essay.referenceAnswerEs).toBe("n");
  });

  it("keeps the correct answer pointing at the same option when a row is removed", () => {
    const d = draftFromQuestion(mc); // correct = 1 ("b")
    expect(removeOptionRow(d, 0).correct).toBe(0);
    expect(removeOptionRow(d, 2).correct).toBe(1);
    expect(removeOptionRow(d, 1).correct).toBeNull();
  });

  it("holds 2 to 6 option rows", () => {
    const two = emptyDraft("multiple_choice");
    expect(removeOptionRow(two, 0).options).toHaveLength(2);
    let d = two;
    for (let i = 0; i < 10; i++) d = addOptionRow(d);
    expect(d.options).toHaveLength(6);
  });

  it("flags edits that move existing scores", () => {
    const d = draftFromQuestion(mc);
    expect(changesScores(mc, d)).toBe(false);
    expect(changesScores(mc, { ...d, correct: 2 })).toBe(true);
    expect(changesScores(mc, { ...d, points: "3" })).toBe(true);
    expect(changesScores({ ...mc, type: "short_essay", correctOption: null }, { ...d, type: "short_essay", correct: 2 })).toBe(false);
  });

  it("totals points by who scores them", () => {
    const qs = [
      { id: "a", type: "multiple_choice" as const, points: 1 },
      { id: "b", type: "short_essay" as const, points: 4 },
    ];
    expect(examTotals(qs)).toMatchObject({ auto: 1, manual: 4, total: 5 });
    expect(examTotals(qs, { id: "b", points: 10 }).total).toBe(11);
  });
});
