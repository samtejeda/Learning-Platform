// Client-side mirror of the grading rules, so a professor hears about a bad
// points entry next to the box instead of after a failed save. The server
// stays the authority (lib/validation/exams.ts, lib/data/exams.ts).

export type PointsCheck = { value: number | null; error: string | null };

export function checkPoints(raw: string, max: number): PointsCheck {
  const t = raw.trim();
  if (t === "") return { value: null, error: "Enter the points for this question." };
  const n = Number(t);
  if (!Number.isFinite(n)) return { value: null, error: "Points must be a number." };
  if (n < 0) return { value: null, error: "Points can't be negative." };
  if (!Number.isInteger(n * 2)) return { value: null, error: "Use whole or half points (for example 2 or 2.5)." };
  if (n > max) return { value: null, error: `Points can't be more than ${max}.` };
  return { value: n, error: null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Running total: the auto-scored points already earned plus every valid entry so far. */
export function runningTotal(autoPoints: number, entries: PointsCheck[]) {
  const given = entries.reduce((sum, e) => sum + (e.value ?? 0), 0);
  const missing = entries.filter((e) => e.value === null).length;
  return { points: round2(autoPoints + given), missing };
}
