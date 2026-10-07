// Fill-in-the-blank representation (pure). A prompt marks each blank with the
// fixed token below. The builder inserts it with an "Insert blank" button;
// a professor never types markup. Blank N is the Nth occurrence in the
// prompt, and a student's answer for it is `blank_answers[N]`.
//
// A question with ZERO blanks (everything created before this existed) is
// "legacy": it keeps one free-text box stored in `answer_text`.

export const BLANK_TOKEN = "{{blank}}";

export function countBlanks(prompt: string | null | undefined): number {
  if (!prompt) return 0;
  return prompt.split(BLANK_TOKEN).length - 1;
}

/** Text segments around the blanks: n blanks → n + 1 segments. */
export function splitOnBlanks(prompt: string | null | undefined): string[] {
  return (prompt ?? "").split(BLANK_TOKEN);
}

/** Largest number of blanks one prompt may hold. */
export const MAX_BLANKS = 20;
