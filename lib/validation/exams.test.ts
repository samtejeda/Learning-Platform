import { describe, expect, it } from "vitest";
import { answersSchema, createQuestionSchema, examFormSchema, gradeSchema, questionFieldsSchema } from "./exams";

describe("examFormSchema", () => {
  it("allows incomplete drafts (empty titles → null) and coerces numbers", () => {
    const r = examFormSchema.parse({ titleEs: "", maxAttempts: "2", durationMinutes: "20" });
    expect(r).toMatchObject({ titleEs: null, titleEn: null, maxAttempts: 2, durationMinutes: 20 });
  });
  it("bounds attempts and time limit", () => {
    expect(examFormSchema.safeParse({ maxAttempts: "0", durationMinutes: "20" }).success).toBe(false);
    expect(examFormSchema.safeParse({ maxAttempts: "2", durationMinutes: "481" }).success).toBe(false);
    expect(examFormSchema.safeParse({ maxAttempts: "", durationMinutes: "20" }).success).toBe(false);
  });
});

describe("createQuestionSchema", () => {
  it("splits options by line and treats an empty key as null", () => {
    const r = createQuestionSchema.parse({ type: "multiple_choice", optionsEs: "a\n b \r\nc\n", correctOption: "" });
    expect(r.optionsEs).toEqual(["a", "b", "c"]);
    expect(r.correctOption).toBeNull();
  });
  it("rejects unknown types, too many options, and out-of-range keys", () => {
    expect(createQuestionSchema.safeParse({ type: "matching" }).success).toBe(false);
    expect(createQuestionSchema.safeParse({ type: "multiple_choice", optionsEs: "1\n2\n3\n4\n5\n6\n7" }).success).toBe(false);
    expect(createQuestionSchema.safeParse({ type: "multiple_choice", correctOption: "9" }).success).toBe(false);
  });
});

describe("answersSchema", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("accepts well-formed answers and rejects extras / bad ids", () => {
    expect(answersSchema.safeParse({ answers: [{ questionId: id, selectedOption: 1 }] }).success).toBe(true);
    expect(answersSchema.safeParse({ answers: [{ questionId: "x", selectedOption: 1 }] }).success).toBe(false);
    expect(answersSchema.safeParse({ answers: [{ questionId: id, grade: 100 }] }).success).toBe(false);
    expect(answersSchema.safeParse({ answers: [], extra: 1 }).success).toBe(false);
  });
});

describe("gradeSchema", () => {
  it("takes points per question in half steps; blank is not 0", () => {
    const u = "11111111-1111-4111-8111-111111111111";
    expect(gradeSchema.parse({ answerPoints: { [u]: "2.5" } }).answerPoints[u]).toBe(2.5);
    expect(gradeSchema.parse({ answerPoints: { [u]: "0" } }).answerPoints[u]).toBe(0);
    for (const bad of ["", "-1", "101", "2.3", "abc"]) {
      expect(gradeSchema.safeParse({ answerPoints: { [u]: bad } }).success).toBe(false);
    }
    expect(gradeSchema.safeParse({ answerPoints: { "not-a-uuid": "1" } }).success).toBe(false);
  });
});

describe("option lines", () => {
  const parse = (optionsEs: string) => questionFieldsSchema.safeParse({ optionsEs });
  it("rejects an empty line before the last option instead of dropping it (it would shift the key)", () => {
    for (const bad of ["a\n\nb", "\na\nb", "a\n   \nb\nc", "a\r\n\r\nb"]) {
      const r = parse(bad);
      expect(r.success).toBe(false);
      expect(!r.success && r.error.issues[0].message).toMatch(/empty line between them/);
    }
  });
  it("trims trailing blank lines and keeps order", () => {
    expect(parse("a\nb\n").data?.optionsEs).toEqual(["a", "b"]);
    expect(parse(" a \n b \n\n  \n").data?.optionsEs).toEqual(["a", "b"]);
    expect(parse("").data?.optionsEs).toEqual([]);
    expect(questionFieldsSchema.parse({}).optionsEs).toEqual([]);
  });
});
