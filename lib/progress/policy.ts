// Pure anti-scrub progress policy: no DB, no Next imports. Unit-tested.
//
// The client only ever reports short "I just played from A to B" segments.
// The server merges them into the set of genuinely watched ranges and
// bounds how fast that set may grow by wall-clock time, so a client that
// fabricates segments (or replays them quickly) cannot earn credit faster
// than real playback. Completion is derived from coverage ÷ duration.

export type Interval = [start: number, end: number];

export type Segment = { from: number; to: number };

export type ProgressState = {
  intervals: Interval[];
  watchedSeconds: number;
  completed: boolean;
  lastUpdated: Date | null;
};

export type RejectReason = "invalid_segment" | "too_long" | "too_fast";

export type ApplyResult =
  | { ok: true; state: ProgressState; gainedSeconds: number; justCompleted: boolean }
  | { ok: false; reason: RejectReason };

/** Longest single segment a client may report (pings are ~10 s apart). */
export const MAX_SEGMENT_SECONDS = 20;
/** Playback-rate tolerance for the wall-clock bound (1.5× speed). */
export const RATE_TOLERANCE = 1.5;
/** Slack added to the wall-clock allowance (timer jitter, latency). */
export const RATE_SLACK_SECONDS = 2;
/** Upper bound on stored intervals so the jsonb column can't be bloated. */
export const MAX_INTERVALS = 500;
/** Ignore sub-frame gaps when merging. */
const EPSILON = 0.05;

/** Sort and merge overlapping/adjacent intervals. Drops malformed ones. */
export function mergeIntervals(input: Interval[]): Interval[] {
  const clean = input
    .filter(
      (iv): iv is Interval =>
        Array.isArray(iv) &&
        iv.length === 2 &&
        Number.isFinite(iv[0]) &&
        Number.isFinite(iv[1]) &&
        iv[0] >= 0 &&
        iv[1] > iv[0],
    )
    .map((iv): Interval => [iv[0], iv[1]])
    .sort((a, b) => a[0] - b[0]);

  const merged: Interval[] = [];
  for (const iv of clean) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1] + EPSILON) {
      last[1] = Math.max(last[1], iv[1]);
    } else {
      merged.push([iv[0], iv[1]]);
    }
  }
  if (merged.length > MAX_INTERVALS) {
    // Keep the largest ranges; a pathological client loses credit, not us.
    merged.sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
    merged.length = MAX_INTERVALS;
    merged.sort((a, b) => a[0] - b[0]);
  }
  return merged;
}

/** Total seconds covered by (already merged) intervals. */
export function coverage(intervals: Interval[]): number {
  return intervals.reduce((sum, [s, e]) => sum + (e - s), 0);
}

/** Is `t` inside a watched range? Used by the player to clamp seeks. */
export function isWatched(intervals: Interval[], t: number): boolean {
  return intervals.some(([s, e]) => t >= s - EPSILON && t <= e + EPSILON);
}

/** Furthest point reachable without a gap from the start. */
export function contiguousFromStart(intervals: Interval[]): number {
  let reach = 0;
  for (const [s, e] of intervals) {
    if (s > reach + EPSILON) break;
    reach = Math.max(reach, e);
  }
  return reach;
}

export function validateSegment(
  seg: Segment,
  durationSeconds: number,
): { ok: true; segment: Segment } | { ok: false; reason: RejectReason } {
  const { from, to } = seg;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { ok: false, reason: "invalid_segment" };
  if (from < 0 || to <= from) return { ok: false, reason: "invalid_segment" };
  if (from > durationSeconds) return { ok: false, reason: "invalid_segment" };
  if (to > durationSeconds + 1) return { ok: false, reason: "invalid_segment" };
  if (to - from > MAX_SEGMENT_SECONDS + EPSILON) return { ok: false, reason: "too_long" };
  return { ok: true, segment: { from, to: Math.min(to, durationSeconds) } };
}

/** Coverage needed for completion, in seconds. */
export function requiredSeconds(durationSeconds: number, thresholdPercent: number): number {
  const pct = Math.min(100, Math.max(0, thresholdPercent));
  return (durationSeconds * pct) / 100;
}

/**
 * Apply one reported segment. Rejects malformed/over-long segments and any
 * segment whose *new* coverage exceeds what wall-clock time since the last
 * accepted ping allows (RATE_TOLERANCE × elapsed + slack). Re-watching
 * already-covered ranges gains nothing and is therefore always allowed.
 */
export function applySegment(
  state: ProgressState,
  seg: Segment,
  opts: { durationSeconds: number; thresholdPercent: number; now: Date },
): ApplyResult {
  const v = validateSegment(seg, opts.durationSeconds);
  if (!v.ok) return v;

  const before = mergeIntervals(state.intervals);
  const beforeCoverage = coverage(before);
  const after = mergeIntervals([...before, [v.segment.from, v.segment.to]]);
  const afterCoverage = coverage(after);
  const gained = afterCoverage - beforeCoverage;

  if (gained > EPSILON && state.lastUpdated) {
    const elapsed = Math.max(0, (opts.now.getTime() - state.lastUpdated.getTime()) / 1000);
    const allowance = elapsed * RATE_TOLERANCE + RATE_SLACK_SECONDS;
    if (gained > allowance) return { ok: false, reason: "too_fast" };
  }

  const required = requiredSeconds(opts.durationSeconds, opts.thresholdPercent);
  const completed = state.completed || (opts.durationSeconds > 0 && afterCoverage + EPSILON >= required);

  return {
    ok: true,
    gainedSeconds: Math.max(0, gained),
    justCompleted: completed && !state.completed,
    state: {
      intervals: after,
      watchedSeconds: Math.min(afterCoverage, opts.durationSeconds),
      completed,
      lastUpdated: opts.now,
    },
  };
}

export function percentWatched(watchedSeconds: number, durationSeconds: number | null): number {
  if (!durationSeconds || durationSeconds <= 0) return 0;
  return Math.min(100, Math.round((watchedSeconds / durationSeconds) * 100));
}
