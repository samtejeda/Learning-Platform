// Exam scoring (pure). Multiple choice and true/false are auto-scored,
// DERIVED AT READ TIME from the stored selected position vs the CURRENT key:
// nothing here is ever stored, so correcting a wrong key re-scores every
// attempt. Fill in the blank and essay are manual: the professor awards
// points per question (0..weight). A result is FINAL once every answered
// manual question has points (or there are none), otherwise PENDING.
//
// Legacy: attempts graded under the earlier model carry one overall 0–100
// grade and no per-question points. They stay readable as a final result
// with that percentage (`legacy: true`, no point totals).

export type ScoreQuestion = {
  id: string;
  type: "multiple_choice" | "true_false" | "fill_in_the_blank" | "short_essay";
  points: number;
  correctOption: number | null;
};

export type ScoreAnswer = {
  questionId: string;
  selectedOption: number | null;
  /** Manual questions only; null until the professor has graded it. */
  pointsAwarded: number | null;
};

export type QuestionState = "correct" | "incorrect" | "unanswered" | "awaiting" | "graded";

export type QuestionScore = {
  questionId: string;
  kind: "auto" | "manual";
  state: QuestionState;
  points: number;
  maxPoints: number;
};

export type AttemptScore = {
  status: "pending" | "final";
  legacy: boolean;
  perQuestion: QuestionScore[];
  autoPoints: number;
  autoMax: number;
  /** Points awarded so far on manual questions. */
  manualPoints: number;
  manualMax: number;
  /** Max points of the manual questions still awaiting the professor. */
  pendingManualMax: number;
  pendingQuestionIds: string[];
  totalPoints: number;
  totalMax: number;
  /** 0–100, only when final (null while pending). */
  percent: number | null;
  /** 0–100 counting only what is scored so far; for display while pending. */
  provisionalPercent: number | null;
};

export const isAutoScored = (t: ScoreQuestion["type"]) => t === "multiple_choice" || t === "true_false";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function scoreAttempt(input: {
  questions: ScoreQuestion[];
  answers: ScoreAnswer[];
  legacyGrade: number | null;
  gradedAt: Date | null;
}): AttemptScore {
  const byQ = new Map(input.answers.map((a) => [a.questionId, a]));
  const perQuestion: QuestionScore[] = [];
  let autoPoints = 0, autoMax = 0, manualPoints = 0, manualMax = 0, pendingManualMax = 0;
  const pendingQuestionIds: string[] = [];

  for (const q of input.questions) {
    const a = byQ.get(q.id);
    if (isAutoScored(q.type)) {
      autoMax += q.points;
      let state: QuestionState = "unanswered";
      if (a && a.selectedOption !== null) {
        state = q.correctOption !== null && a.selectedOption === q.correctOption ? "correct" : "incorrect";
      }
      const points = state === "correct" ? q.points : 0;
      autoPoints += points;
      perQuestion.push({ questionId: q.id, kind: "auto", state, points, maxPoints: q.points });
    } else {
      manualMax += q.points;
      if (!a) {
        perQuestion.push({ questionId: q.id, kind: "manual", state: "unanswered", points: 0, maxPoints: q.points });
      } else if (a.pointsAwarded === null) {
        pendingManualMax += q.points;
        pendingQuestionIds.push(q.id);
        perQuestion.push({ questionId: q.id, kind: "manual", state: "awaiting", points: 0, maxPoints: q.points });
      } else {
        const points = Math.min(Math.max(a.pointsAwarded, 0), q.points); // weight may have been lowered since
        manualPoints += points;
        perQuestion.push({ questionId: q.id, kind: "manual", state: "graded", points, maxPoints: q.points });
      }
    }
  }

  const totalMax = autoMax + manualMax;
  const base = { perQuestion, autoMax, manualMax, totalMax };

  if (input.gradedAt !== null && input.legacyGrade !== null) {
    return {
      ...base,
      status: "final",
      legacy: true,
      autoPoints: 0,
      manualPoints: 0,
      pendingManualMax: 0,
      pendingQuestionIds: [],
      totalPoints: 0,
      percent: input.legacyGrade,
      provisionalPercent: input.legacyGrade,
    };
  }

  const totalPoints = round2(autoPoints + manualPoints);
  const provisionalPercent = totalMax > 0 ? round2((totalPoints / totalMax) * 100) : null;
  const status = pendingQuestionIds.length === 0 ? "final" : "pending";
  return {
    ...base,
    status,
    legacy: false,
    autoPoints: round2(autoPoints),
    manualPoints: round2(manualPoints),
    pendingManualMax,
    pendingQuestionIds,
    totalPoints,
    percent: status === "final" ? provisionalPercent : null,
    provisionalPercent,
  };
}

/** Grade of record: the highest percent among FINAL attempts (null if none). */
export function gradeOfRecord(scores: AttemptScore[]): number | null {
  const finals = scores.map((s) => s.percent).filter((p): p is number => p !== null);
  return finals.length ? Math.max(...finals) : null;
}
