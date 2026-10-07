// Pure helpers for the fill-in-the-blank prompt editor. The editor keeps a
// prompt as text SEGMENTS with a blank between each pair (n blanks → n + 1
// segments), so a professor never sees or types the storage token. The saved
// prompt is the segments joined with the backend's token (lib/exams/blanks.ts).

import { BLANK_TOKEN, MAX_BLANKS, splitOnBlanks } from "@/lib/exams/blanks";

export function toSegments(prompt: string | null | undefined): string[] {
  return splitOnBlanks(prompt);
}

export function fromSegments(segments: string[]): string {
  return segments.join(BLANK_TOKEN);
}

/** Typed or pasted text may never contain the token: blanks come from the button only. */
export function stripToken(text: string): string {
  return text.split(BLANK_TOKEN).join("");
}

export function blankCount(segments: string[]): number {
  return Math.max(0, segments.length - 1);
}

export function canInsertBlank(segments: string[]): boolean {
  return blankCount(segments) < MAX_BLANKS;
}

/** Split segment `index` at `cursor`, putting a blank in the gap. Returns the new segments and where the cursor should land (the start of the segment after the new blank). */
export function insertBlank(
  segments: string[],
  index: number,
  cursor: number,
): { segments: string[]; focusSegment: number } {
  const i = Math.min(Math.max(index, 0), segments.length - 1);
  const text = segments[i] ?? "";
  const at = Math.min(Math.max(cursor, 0), text.length);
  const next = [...segments.slice(0, i), text.slice(0, at), text.slice(at), ...segments.slice(i + 1)];
  return { segments: next, focusSegment: i + 1 };
}

/** Delete blank number `blank` (0-based): the text on both sides joins back together. */
export function removeBlank(segments: string[], blank: number): string[] {
  if (blank < 0 || blank >= segments.length - 1) return segments;
  return [...segments.slice(0, blank), segments[blank] + segments[blank + 1], ...segments.slice(blank + 2)];
}
