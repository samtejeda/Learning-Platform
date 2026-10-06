import { describe, expect, it } from "vitest";
import { answersSchema, createQuestionSchema, examFormSchema, gradeSchema } from "./exams";

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
    const r = createQuestionSchema.parse({ type: "multiple_choice", optionsEs: "a\n\n b \r\nc", correctOption: "" });
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
  it("requires a grade in 0–100; blank is not 0", () => {
    expect(gradeSchema.safeParse({ grade: "" }).success).toBe(false);
    expect(gradeSchema.safeParse({ grade: "101" }).success).toBe(false);
    expect(gradeSchema.safeParse({ grade: "-1" }).success).toBe(false);
    expect(gradeSchema.parse({ grade: "87.5" }).grade).toBe(87.5);
  });
});
