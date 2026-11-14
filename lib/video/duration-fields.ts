// Pure helpers for the professor's minutes + seconds duration fields on a
// YouTube lecture. The server (lib/validation/lectures.ts) is the authority on
// what a valid duration is; this only turns two text boxes into one number and
// back, and gives the professor an early, plain message.

const MAX_MINUTES = 24 * 60;

/** 2730 → { minutes: "45", seconds: "30" }; null/invalid → both blank. */
export function splitDuration(total: number | null | undefined): { minutes: string; seconds: string } {
  if (typeof total !== "number" || !Number.isFinite(total) || total < 1) return { minutes: "", seconds: "" };
  const whole = Math.round(total);
  return { minutes: String(Math.floor(whole / 60)), seconds: String(whole % 60) };
}

function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  return Number(trimmed);
}

/**
 * The two boxes as seconds, or null when both are blank, either holds something
 * that isn't a whole number, seconds are over 59, or the total is under one
 * second or implausibly long.
 */
export function combineDuration(minutes: string, seconds: string): number | null {
  if (minutes.trim() === "" && seconds.trim() === "") return null;
  const m = wholeNumber(minutes);
  const s = wholeNumber(seconds);
  if (m === null || s === null || s > 59 || m > MAX_MINUTES) return null;
  const total = m * 60 + s;
  return total >= 1 && total <= MAX_MINUTES * 60 ? total : null;
}

/** A plain message for the duration boxes, or null when they're fine. Blank is not an error here (the form says "required" on submit). */
export function durationFieldMessage(minutes: string, seconds: string): string | null {
  if (minutes.trim() === "" && seconds.trim() === "") return null;
  const m = wholeNumber(minutes);
  const s = wholeNumber(seconds);
  if (m === null || s === null) return "Use whole numbers for minutes and seconds.";
  if (s > 59) return "Seconds must be between 0 and 59.";
  if (m > MAX_MINUTES) return "That duration is implausibly long.";
  if (m * 60 + s < 1) return "Duration must be at least one second.";
  return null;
}
