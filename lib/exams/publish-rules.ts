import { countBlanks } from "./blanks";
import { asStringArray } from "./language";
import { MC_MAX_OPTIONS, MC_MIN_OPTIONS } from "./limits";

// Publish gate (pure). Drafts may be incomplete; publishing requires BOTH
// languages everywhere plus a key for the types that have one. The publish
// action runs this inside the transaction that locks the exam row, so the UI
// is never trusted. Messages are interface text; they never quote content.

export type PublishExam = { titleEs: string | null; titleEn: string | null };

export type PublishQuestion = {
  type: "multiple_choice" | "true_false" | "fill_in_the_blank" | "short_essay";
  promptEs: string | null;
  promptEn: string | null;
  optionsEs: unknown;
  optionsEn: unknown;
  correctOption: number | null;
};

export type PublishProblem = {
  /** 1-based question number, or null for exam-level problems. */
  question: number | null;
  message: string;
};

const blank = (v: string | null) => !v || v.trim().length === 0;

export function examPublishProblems(exam: PublishExam, questions: PublishQuestion[]): PublishProblem[] {
  const problems: PublishProblem[] = [];
  if (blank(exam.titleEs)) problems.push({ question: null, message: "Add a Spanish title." });
  if (blank(exam.titleEn)) problems.push({ question: null, message: "Add an English title." });
  if (questions.length === 0) problems.push({ question: null, message: "Add at least one question." });

  questions.forEach((q, i) => {
    const n = i + 1;
    if (blank(q.promptEs)) problems.push({ question: n, message: "Add the Spanish prompt." });
    if (blank(q.promptEn)) problems.push({ question: n, message: "Add the English prompt." });

    if (q.type === "multiple_choice") {
      const es = asStringArray(q.optionsEs).map((o) => o.trim());
      const en = asStringArray(q.optionsEn).map((o) => o.trim());
      if (es.length < MC_MIN_OPTIONS || es.length > MC_MAX_OPTIONS || es.some((o) => !o)) {
        problems.push({ question: n, message: `Spanish options: ${MC_MIN_OPTIONS}–${MC_MAX_OPTIONS}, none empty.` });
      }
      if (en.length < MC_MIN_OPTIONS || en.length > MC_MAX_OPTIONS || en.some((o) => !o)) {
        problems.push({ question: n, message: `English options: ${MC_MIN_OPTIONS}–${MC_MAX_OPTIONS}, none empty.` });
      }
      if (es.length !== en.length) {
        problems.push({ question: n, message: "Spanish and English must have the same number of options." });
      }
      if (q.correctOption === null || q.correctOption < 0 || q.correctOption >= Math.min(es.length, en.length)) {
        problems.push({ question: n, message: "Mark which option is the key." });
      }
    } else if (q.type === "fill_in_the_blank") {
      if (countBlanks(q.promptEs) !== countBlanks(q.promptEn)) {
        problems.push({ question: n, message: "Spanish and English prompts must have the same number of blanks." });
      }
    } else if (q.type === "true_false") {
      if (q.correctOption !== 0 && q.correctOption !== 1) {
        problems.push({ question: n, message: "Mark whether the key is true or false." });
      }
    }
  });
  return problems;
}
