// Pure watched-interval bookkeeping for the anti-scrub player. No DOM, no
// React, so it can be unit-tested and reasoned about on its own.
//
// The player records the ranges of the video the student has actually had
// playing (as [start, end] seconds). From those we derive:
//   - totalWatched: seconds genuinely watched (sent to the server, which is
//     the authority on "complete")
//   - frontier: the furthest point they've reached, i.e. how far a seek may go
//
// The client uses these to *guide* the UI (snap back forward seeks, show the
// watched region). The server re-validates every progress ping, so nothing
// here is a security boundary.

export type Interval = readonly [start: number, end: number];

/** Forward seeks may land this far past the frontier (covers keyframe snapping). */
export const SEEK_TOLERANCE_SECONDS = 2;

/**
 * Largest jump between two consecutive `timeupdate` events that still counts
 * as continuous playback. Browsers fire timeupdate ~4×/s; background tabs
 * throttle to ~1×/s. Anything larger is a seek and is not recorded.
 */
export const MAX_PLAYBACK_STEP_SECONDS = 2;

/** Merge overlapping/touching intervals and sort by start. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .map(([s, e]) => [Math.max(0, s), e] as Interval)
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      out.push([s, e]);
    }
  }
  return out;
}

/** Add one watched range and return the merged list. */
export function addInterval(intervals: readonly Interval[], start: number, end: number): Interval[] {
  if (!(end > start)) return [...intervals];
  return mergeIntervals([...intervals, [start, end]]);
}

/**
 * Apply a `timeupdate`: if the video advanced by a plausible amount since the
 * last tick, record [previous, current] as watched. Jumps (seeks) and
 * backwards moves are ignored — they'll be recorded once playback resumes.
 */
export function applyTimeUpdate(
  intervals: readonly Interval[],
  previousTime: number,
  currentTime: number,
  maxStep: number = MAX_PLAYBACK_STEP_SECONDS,
): Interval[] {
  const delta = currentTime - previousTime;
  if (delta <= 0 || delta > maxStep) return [...intervals];
  return addInterval(intervals, previousTime, currentTime);
}

/** Seconds covered by the (merged) intervals. */
export function totalWatched(intervals: readonly Interval[]): number {
  return mergeIntervals(intervals).reduce((sum, [s, e]) => sum + (e - s), 0);
}

/** The furthest point reached; 0 if nothing watched. */
export function frontier(intervals: readonly Interval[]): number {
  let max = 0;
  for (const [, e] of intervals) if (e > max) max = e;
  return max;
}

/** 0–100, clamped. Returns 0 when duration is unknown. */
export function watchedPercent(intervals: readonly Interval[], duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.max(0, Math.min(100, (totalWatched(intervals) / duration) * 100));
}

/**
 * May the student seek to `target`? Backwards and within the watched region
 * is always fine; forward is allowed up to the frontier plus a small tolerance.
 */
export function isSeekAllowed(
  target: number,
  currentFrontier: number,
  tolerance: number = SEEK_TOLERANCE_SECONDS,
): boolean {
  return target <= currentFrontier + tolerance;
}

/** Where to put the playhead after a rejected seek. */
export function clampSeek(target: number, currentFrontier: number, tolerance: number = SEEK_TOLERANCE_SECONDS): number {
  return isSeekAllowed(target, currentFrontier, tolerance) ? Math.max(0, target) : currentFrontier;
}

/**
 * Reconstruct intervals from the server's stored `watchedSeconds` on page
 * load. We don't persist the interval list, so approximate it as one range
 * from 0 — which is exactly the region a no-skip player would have covered.
 */
export function intervalsFromWatchedSeconds(watchedSeconds: number): Interval[] {
  return watchedSeconds > 0 ? [[0, watchedSeconds]] : [];
}
