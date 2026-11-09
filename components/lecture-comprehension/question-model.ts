// Pure model behind the lecture-question authoring form: the draft state, how
// it maps onto the server's flat form fields (q1PromptEs … q2Correct, options
// one per line), and the plain-language reasons a save would store something
// unusable. No React, so it is unit-tested. Wording is never authored here:
// every string below is interface text that names a field, not content.

import { COMPREHENSION_MAX_OPTIONS, COMPREHENSION_MIN_OPTIONS } from "@/lib/lectures/comprehension";

export type OptionRow = { es: string; en: string };

export type SlotDraft = {
  promptEs: string;
  promptEn: string;
  /** One row per option, both languages side by side, so counts and order always match. */
  options: OptionRow[];
  /** POSITION of the correct option; null = not chosen yet. */
  correct: number | null;
};

export type ComprehensionDraft = [SlotDraft, SlotDraft];

/** The shape of a saved question the professor DTO returns (key included). */
export type SavedSlot = {
  slot: number;
  promptEs: string | null;
  promptEn: string | null;
  optionsEs: string[];
  optionsEn: string[];
  correctOption: number | null;
};

export const MAX_OPTION_ROWS = COMPREHENSION_MAX_OPTIONS;
export const MIN_OPTION_ROWS = COMPREHENSION_MIN_OPTIONS;

export function emptySlot(): SlotDraft {
  return {
    promptEs: "",
    promptEn: "",
    options: Array.from({ length: MIN_OPTION_ROWS }, () => ({ es: "", en: "" })),
    correct: null,
  };
}

export function draftFromSaved(saved: readonly SavedSlot[]): ComprehensionDraft {
  const one = (slot: number): SlotDraft => {
    const q = saved.find((s) => s.slot === slot);
    if (!q) return emptySlot();
    const rows = Math.max(q.optionsEs.length, q.optionsEn.length, MIN_OPTION_ROWS);
    return {
      promptEs: q.promptEs ?? "",
      promptEn: q.promptEn ?? "",
      options: Array.from({ length: rows }, (_, i) => ({ es: q.optionsEs[i] ?? "", en: q.optionsEn[i] ?? "" })),
      correct: q.correctOption,
    };
  };
  return [one(1), one(2)];
}

const empty = (s: string) => s.trim().length === 0;

/** Option rows with trailing fully-empty rows dropped (the server trims those too). */
export function filledRows(slot: SlotDraft): OptionRow[] {
  const rows = [...slot.options];
  while (rows.length > 0 && empty(rows[rows.length - 1].es) && empty(rows[rows.length - 1].en)) rows.pop();
  return rows;
}

export function isBlankSlot(slot: SlotDraft): boolean {
  return empty(slot.promptEs) && empty(slot.promptEn) && filledRows(slot).length === 0 && slot.correct === null;
}

/** The exact field values saveLectureComprehension expects. */
export function toFormFields(draft: ComprehensionDraft): Record<string, string> {
  const out: Record<string, string> = {};
  draft.forEach((slot, i) => {
    const n = i + 1;
    const rows = filledRows(slot);
    out[`q${n}PromptEs`] = slot.promptEs.trim();
    out[`q${n}PromptEn`] = slot.promptEn.trim();
    out[`q${n}OptionsEs`] = rows.map((r) => r.es.trim()).join("\n");
    out[`q${n}OptionsEn`] = rows.map((r) => r.en.trim()).join("\n");
    out[`q${n}Correct`] = slot.correct !== null && slot.correct < rows.length ? String(slot.correct) : "";
  });
  return out;
}

/**
 * Reasons a save would store something wrong or unusable. Wording gaps are NOT
 * listed: a draft may be incomplete, and the "ready to turn on" checklist names
 * those. What blocks a save is what would shift or lose the answer key.
 */
export function saveBlockers(draft: ComprehensionDraft): string[] {
  const out: string[] = [];
  draft.forEach((slot, i) => {
    const n = i + 1;
    const rows = filledRows(slot);
    rows.forEach((r, k) => {
      if (empty(r.es) && empty(r.en)) out.push(`Question ${n}: option ${k + 1} is empty. Fill it in or remove it.`);
      else if (empty(r.es) || empty(r.en)) out.push(`Question ${n}: fill in option ${k + 1} in both languages, or remove it.`);
    });
    if (slot.correct !== null && slot.correct >= rows.length) {
      out.push(`Question ${n}: the correct answer is marked on an empty option. Mark one you have filled in.`);
    }
  });
  return out;
}

export function addOptionRow(slot: SlotDraft): SlotDraft {
  if (slot.options.length >= MAX_OPTION_ROWS) return slot;
  return { ...slot, options: [...slot.options, { es: "", en: "" }] };
}

export function removeOptionRow(slot: SlotDraft, index: number): SlotDraft {
  if (slot.options.length <= MIN_OPTION_ROWS) return slot;
  let correct = slot.correct;
  if (correct !== null) {
    if (correct === index) correct = null;
    else if (correct > index) correct -= 1;
  }
  return { ...slot, options: slot.options.filter((_, i) => i !== index), correct };
}

export function sameFields(a: ComprehensionDraft, b: ComprehensionDraft): boolean {
  return JSON.stringify(toFormFields(a)) === JSON.stringify(toFormFields(b));
}

export type PreviewQuestion = {
  slot: 1 | 2;
  es: { prompt: string; options: string[] };
  en: { prompt: string; options: string[] };
};

/** What the student would be shown for each written slot (never the key). */
export function previewQuestions(draft: ComprehensionDraft): PreviewQuestion[] {
  return draft.flatMap((slot, i) => {
    if (isBlankSlot(slot)) return [];
    const rows = filledRows(slot);
    return [
      {
        slot: (i + 1) as 1 | 2,
        es: { prompt: slot.promptEs.trim(), options: rows.map((r) => r.es.trim()) },
        en: { prompt: slot.promptEn.trim(), options: rows.map((r) => r.en.trim()) },
      },
    ];
  });
}
