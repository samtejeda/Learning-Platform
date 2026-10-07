import { describe, expect, it } from "vitest";
import { gradeOfRecord, scoreAttempt, type ScoreQuestion } from "./scoring";

const q = (id: string, type: ScoreQuestion["type"], points = 1, correctOption: number | null = null): ScoreQuestion => ({
  id, type, points, correctOption,
});
const mc = q("mc", "multiple_choice", 2, 1);
const tf = q("tf", "true_false", 1, 0);
const fill = q("fill", "fill_in_the_blank", 3);
const essay = q("essay", "short_essay", 4);
const none = { legacyGrade: null, gradedAt: null };

describe("scoreAttempt", () => {
  it("auto-scores multiple choice and true/false by position, weighted", () => {
    const s = scoreAttempt({ questions: [mc, tf], answers: [
      { questionId: "mc", selectedOption: 1, pointsAwarded: null },
      { questionId: "tf", selectedOption: 1, pointsAwarded: null },
    ], ...none });
    expect(s.perQuestion.map((p) => p.state)).toEqual(["correct", "incorrect"]);
    expect(s).toMatchObject({ autoPoints: 2, autoMax: 3, status: "final", percent: 66.67, legacy: false });
  });
  it("re-scores when the key changes (derived, never stored)", () => {
    const answers = [{ questionId: "mc", selectedOption: 0, pointsAwarded: null }];
    expect(scoreAttempt({ questions: [mc], answers, ...none }).autoPoints).toBe(0);
    expect(scoreAttempt({ questions: [{ ...mc, correctOption: 0 }], answers, ...none }).autoPoints).toBe(2);
  });
  it("an unanswered auto question scores 0", () => {
    const s = scoreAttempt({ questions: [mc], answers: [], ...none });
    expect(s.perQuestion[0]).toMatchObject({ state: "unanswered", points: 0 });
  });
  it("is pending while an answered manual question has no points, naming it", () => {
    const s = scoreAttempt({ questions: [mc, fill, essay], answers: [
      { questionId: "mc", selectedOption: 1, pointsAwarded: null },
      { questionId: "fill", selectedOption: null, pointsAwarded: 2 },
      { questionId: "essay", selectedOption: null, pointsAwarded: null },
    ], ...none });
    expect(s).toMatchObject({
      status: "pending", percent: null, autoPoints: 2, manualPoints: 2, pendingManualMax: 4,
      pendingQuestionIds: ["essay"], totalMax: 9, provisionalPercent: 44.44,
    });
  });
  it("is final once every answered manual question is graded; unanswered manual = 0, not pending", () => {
    const s = scoreAttempt({ questions: [fill, essay], answers: [{ questionId: "fill", selectedOption: null, pointsAwarded: 3 }], ...none });
    expect(s).toMatchObject({ status: "final", totalPoints: 3, totalMax: 7 });
    expect(s.perQuestion[1].state).toBe("unanswered");
  });
  it("clamps awarded points to a weight that was lowered afterwards", () => {
    const s = scoreAttempt({ questions: [fill], answers: [{ questionId: "fill", selectedOption: null, pointsAwarded: 3 }], ...none });
    const lowered = scoreAttempt({ questions: [{ ...fill, points: 1 }], answers: [{ questionId: "fill", selectedOption: null, pointsAwarded: 3 }], ...none });
    expect(s.totalPoints).toBe(3);
    expect(lowered.totalPoints).toBe(1);
  });
  it("reads a legacy overall grade as a final percent", () => {
    const s = scoreAttempt({ questions: [mc, essay], answers: [], legacyGrade: 70, gradedAt: new Date() });
    expect(s).toMatchObject({ legacy: true, status: "final", percent: 70 });
  });
  it("grade of record is the highest FINAL percent; pending attempts don't count", () => {
    const pend = scoreAttempt({ questions: [essay], answers: [{ questionId: "essay", selectedOption: null, pointsAwarded: null }], ...none });
    const a = scoreAttempt({ questions: [mc], answers: [{ questionId: "mc", selectedOption: 0, pointsAwarded: null }], ...none });
    const b = scoreAttempt({ questions: [mc], answers: [{ questionId: "mc", selectedOption: 1, pointsAwarded: null }], ...none });
    expect(gradeOfRecord([pend, a, b])).toBe(100);
    expect(gradeOfRecord([pend])).toBeNull();
  });
});
