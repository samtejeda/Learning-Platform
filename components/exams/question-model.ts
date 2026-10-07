// Pure model behind the guided question editor: the editor's draft state, how
// it maps onto the server's form fields, and the plain-language reasons a
// question can't be saved yet. No React here, so it is unit-tested.

import { isAutoScored } from "@/lib/exams/scoring";
import { MAX_POINTS, MC_MAX_OPTIONS, MC_MIN_OPTIONS, MIN_POINTS } from "@/lib/exams/limits";
import { blankCount, fromSegments, toSegments } from "./prompt-blanks";

export type QuestionType = "multiple_choice" | "true_false" | "fill_in_the_blank" | "short_essay";

export type QuestionDraft = {
  type: QuestionType | null;
  /** Prompt as text segments (n blanks → n + 1 segments). Only fill-in-the-blank has more than one. */
  promptEs: string[];
  promptEn: string[];
  /** Multiple choice: one row per option, both languages side by side. */
  options: { es: string; en: string }[];
  /** Position of the correct answer (multiple choice row, or 0 = true / 1 = false). Null = not chosen. */
  correct: number | null;
  points: string;
  notesEs: string;
  notesEn: string;
};

export const TYPE_INFO: Record<QuestionType, { label: string; blurb: string }> = {
  multiple_choice: { label: "Multiple choice", blurb: "Students pick one answer. Scored automatically." },
  true_false: { label: "True / false", blurb: "Students pick true or false. Scored automatically." },
  fill_in_the_blank: { label: "Fill in the blank", blurb: "Students type into blanks. You check it by hand." },
  short_essay: { label: "Essay", blurb: "Students write an answer. You grade it by hand." },
};

export const TYPE_ORDER: QuestionType[] = ["multiple_choice", "true_false", "fill_in_the_blank", "short_essay"];

export const emptyOptions = () => [
  { es: "", en: "" },
  { es: "", en: "" },
];

export function emptyDraft(type: QuestionType | null = null): QuestionDraft {
  return {
    type,
    promptEs: [""],
    promptEn: [""],
    options: emptyOptions(),
    correct: null,
    points: "1",
    notesEs: "",
    notesEn: "",
  };
}

export type SavedQuestion = {
  type: QuestionType;
  promptEs: string | null;
  promptEn: string | null;
  optionsEs: string[] | null;
  optionsEn: string[] | null;
  correctOption: number | null;
  referenceAnswerEs: string | null;
  referenceAnswerEn: string | null;
  points: number;
};

export function draftFromQuestion(q: SavedQuestion): QuestionDraft {
  const es = q.optionsEs ?? [];
  const en = q.optionsEn ?? [];
  const rows = Math.max(es.length, en.length, q.type === "multiple_choice" ? MC_MIN_OPTIONS : 0);
  return {
    type: q.type,
    promptEs: q.type === "fill_in_the_blank" ? toSegments(q.promptEs) : [q.promptEs ?? ""],
    promptEn: q.type === "fill_in_the_blank" ? toSegments(q.promptEn) : [q.promptEn ?? ""],
    options: Array.from({ length: rows }, (_, i) => ({ es: es[i] ?? "", en: en[i] ?? "" })),
    correct: q.correctOption,
    points: String(q.points),
    notesEs: q.referenceAnswerEs ?? "",
    notesEn: q.referenceAnswerEn ?? "",
  };
}

/** The exact field values the server actions expect (same names as before the rebuild). */
export function toFormFields(d: QuestionDraft): Record<string, string> {
  const f: Record<string, string> = {
    promptEs: fromSegments(d.promptEs),
    promptEn: fromSegments(d.promptEn),
    points: d.points.trim(),
  };
  if (d.type) f.type = d.type;
  if (d.type === "multiple_choice") {
    f.optionsEs = d.options.map((o) => o.es.trim()).join("\n");
    f.optionsEn = d.options.map((o) => o.en.trim()).join("\n");
  }
  if (d.type === "multiple_choice" || d.type === "true_false") f.correctOption = d.correct === null ? "" : String(d.correct);
  if (d.type === "fill_in_the_blank" || d.type === "short_essay") {
    f.referenceAnswerEs = d.notesEs;
    f.referenceAnswerEn = d.notesEn;
  }
  return f;
}

export function parsePoints(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= MIN_POINTS && n <= MAX_POINTS ? n : null;
}

/**
 * Plain-language reasons the question can't be saved yet (empty = can save).
 * Wording gaps are NOT listed: a draft may be incomplete, and the publish
 * checklist names those. What blocks a save is what would store a wrong or
 * unusable answer key.
 */
export function saveBlockers(d: QuestionDraft): string[] {
  const out: string[] = [];
  if (!d.type) return ["Choose what kind of question this is."];
  if (parsePoints(d.points) === null) out.push(`Points must be a whole number from ${MIN_POINTS} to ${MAX_POINTS}.`);
  if (d.type === "multiple_choice") {
    if (d.options.length < MC_MIN_OPTIONS) out.push(`Add at least ${MC_MIN_OPTIONS} options.`);
    d.options.forEach((o, i) => {
      if (!o.es.trim() || !o.en.trim()) out.push(`Fill in option ${i + 1} in both languages, or remove it.`);
    });
    if (d.correct === null || d.correct >= d.options.length) out.push("Choose the correct answer.");
  }
  if (d.type === "true_false" && d.correct === null) out.push("Choose whether the correct answer is true or false.");
  return out;
}

export function blanksInDraft(d: QuestionDraft): { es: number; en: number } {
  return { es: blankCount(d.promptEs), en: blankCount(d.promptEn) };
}

/** Add/remove option rows and insert/delete blanks only while no student has started. */
export const MAX_OPTION_ROWS = MC_MAX_OPTIONS;

export function removeOptionRow(d: QuestionDraft, index: number): QuestionDraft {
  if (d.options.length <= MC_MIN_OPTIONS) return d;
  const options = d.options.filter((_, i) => i !== index);
  let correct = d.correct;
  if (correct !== null) {
    if (correct === index) correct = null;
    else if (correct > index) correct -= 1;
  }
  return { ...d, options, correct };
}

export function addOptionRow(d: QuestionDraft): QuestionDraft {
  if (d.options.length >= MC_MAX_OPTIONS) return d;
  return { ...d, options: [...d.options, { es: "", en: "" }] };
}

/** True if saving `next` over `saved` changes something that moves existing students' scores. */
export function changesScores(saved: SavedQuestion, next: QuestionDraft): boolean {
  if (next.points.trim() !== String(saved.points)) return true;
  return isAutoScored(saved.type) && next.correct !== saved.correctOption;
}

/** Exam total in points, with `override` replacing one question's weight (the one being edited). */
export function examTotals(
  questions: { id: string; type: QuestionType; points: number }[],
  override?: { id: string | null; points: number | null },
) {
  let auto = 0;
  let manual = 0;
  let overrideCounted = false;
  for (const q of questions) {
    const p = override && override.id === q.id && override.points !== null ? override.points : q.points;
    if (override && override.id === q.id) overrideCounted = true;
    if (isAutoScored(q.type)) auto += p;
    else manual += p;
  }
  return { auto, manual, total: auto + manual, overrideCounted };
}
