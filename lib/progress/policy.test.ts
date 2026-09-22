import { describe, expect, it } from "vitest";
import {
  applySegment,
  contiguousFromStart,
  coverage,
  isWatched,
  MAX_SEGMENT_SECONDS,
  mergeIntervals,
  percentWatched,
  validateSegment,
  type ProgressState,
} from "./policy";

const fresh = (): ProgressState => ({ intervals: [], watchedSeconds: 0, completed: false, lastUpdated: null });
const at = (s: number) => new Date(1_700_000_000_000 + s * 1000);
const opts = (now: Date, durationSeconds = 100, thresholdPercent = 95) => ({ durationSeconds, thresholdPercent, now });

describe("mergeIntervals / coverage", () => {
  it("merges overlapping and adjacent ranges and sorts them", () => {
    expect(mergeIntervals([[10, 20], [0, 10], [19, 25], [40, 50]])).toEqual([[0, 25], [40, 50]]);
    expect(coverage([[0, 25], [40, 50]])).toBe(35);
  });
  it("drops malformed intervals", () => {
    expect(mergeIntervals([[5, 5], [-1, 3], [NaN, 2], [2, 4]] as never)).toEqual([[2, 4]]);
    expect(mergeIntervals([["a", "b"], null, [1]] as never)).toEqual([]);
  });
  it("isWatched and contiguousFromStart", () => {
    const iv = mergeIntervals([[0, 30], [50, 60]]);
    expect(isWatched(iv, 15)).toBe(true);
    expect(isWatched(iv, 40)).toBe(false);
    expect(contiguousFromStart(iv)).toBe(30);
    expect(contiguousFromStart([[5, 30]])).toBe(0);
  });
});

describe("validateSegment", () => {
  it("rejects malformed, out-of-range, and over-long segments", () => {
    expect(validateSegment({ from: -1, to: 5 }, 100)).toMatchObject({ ok: false, reason: "invalid_segment" });
    expect(validateSegment({ from: 5, to: 5 }, 100)).toMatchObject({ ok: false, reason: "invalid_segment" });
    expect(validateSegment({ from: 10, to: 5 }, 100)).toMatchObject({ ok: false, reason: "invalid_segment" });
    expect(validateSegment({ from: 95, to: 105 }, 100)).toMatchObject({ ok: false, reason: "invalid_segment" });
    expect(validateSegment({ from: 0, to: MAX_SEGMENT_SECONDS + 1 }, 100)).toMatchObject({ ok: false, reason: "too_long" });
    expect(validateSegment({ from: 0, to: 600 }, 1000)).toMatchObject({ ok: false, reason: "too_long" });
  });
  it("clamps the tail to the duration", () => {
    expect(validateSegment({ from: 90, to: 100.5 }, 100)).toEqual({ ok: true, segment: { from: 90, to: 100 } });
  });
});

describe("applySegment", () => {
  it("accepts a first segment and accrues coverage", () => {
    const r = applySegment(fresh(), { from: 0, to: 10 }, opts(at(10)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.watchedSeconds).toBe(10);
    expect(r.state.completed).toBe(false);
    expect(r.gainedSeconds).toBe(10);
  });

  it("normal 1× playback: 10 s segments every 10 s are all accepted", () => {
    let state = fresh();
    for (let t = 0; t < 100; t += 10) {
      const r = applySegment(state, { from: t, to: t + 10 }, opts(at(t + 10)));
      expect(r.ok, `segment at ${t}`).toBe(true);
      if (r.ok) state = r.state;
    }
    expect(state.watchedSeconds).toBe(100);
    expect(state.completed).toBe(true);
  });

  it("rejects segments that arrive faster than wall-clock allows", () => {
    const first = applySegment(fresh(), { from: 0, to: 10 }, opts(at(10)));
    if (!first.ok) throw new Error();
    // 20 s of new material claimed 1 s later: allowance = 1×1.5 + 2 = 3.5.
    const spam = applySegment(first.state, { from: 10, to: 30 }, opts(at(11)));
    expect(spam).toEqual({ ok: false, reason: "too_fast" });
    // Same segment after a realistic wait is fine.
    const later = applySegment(first.state, { from: 10, to: 30 }, opts(at(25)));
    expect(later.ok).toBe(true);
  });

  it("tolerates 1.5× playback but not 2×", () => {
    const first = applySegment(fresh(), { from: 0, to: 10 }, opts(at(10)));
    if (!first.ok) throw new Error();
    // 15 s of media in 10 s wall-clock → allowance 17 → ok
    expect(applySegment(first.state, { from: 10, to: 25 }, opts(at(20))).ok).toBe(true);
    // 20 s of media in 10 s → allowance 17 → rejected
    expect(applySegment(first.state, { from: 10, to: 30 }, opts(at(20)))).toEqual({ ok: false, reason: "too_fast" });
  });

  it("re-watching covered ranges gains nothing and is always allowed", () => {
    const first = applySegment(fresh(), { from: 0, to: 20 }, opts(at(20)));
    if (!first.ok) throw new Error();
    const again = applySegment(first.state, { from: 0, to: 20 }, opts(at(20.1)));
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.gainedSeconds).toBe(0);
      expect(again.state.watchedSeconds).toBe(20);
    }
  });

  it("a skipped middle never counts, so completion needs the gap filled", () => {
    let state = fresh();
    const steps: [number, number, number][] = [[0, 20, 20], [80, 100, 40]]; // watched start and end only
    for (const [from, to, now] of steps) {
      const r = applySegment(state, { from, to }, opts(at(now)));
      if (r.ok) state = r.state;
    }
    expect(state.watchedSeconds).toBe(40);
    expect(state.completed).toBe(false);
    // Fill the gap at a realistic pace.
    for (let t = 20; t < 80; t += 10) {
      const r = applySegment(state, { from: t, to: t + 10 }, opts(at(60 + t)));
      if (r.ok) state = r.state;
    }
    expect(state.completed).toBe(true);
    expect(state.intervals).toEqual([[0, 100]]);
  });

  it("completion is reached at the threshold and is sticky", () => {
    let state = fresh();
    for (let t = 0; t < 95; t += 10) {
      const r = applySegment(state, { from: t, to: Math.min(t + 10, 95) }, opts(at(t + 10)));
      if (r.ok) state = r.state;
    }
    expect(state.watchedSeconds).toBe(95);
    expect(state.completed).toBe(true);
    const r = applySegment(state, { from: 95, to: 100 }, opts(at(120)));
    expect(r.ok && r.state.completed && !r.justCompleted).toBe(true);
  });

  it("percentWatched", () => {
    expect(percentWatched(50, 100)).toBe(50);
    expect(percentWatched(50, null)).toBe(0);
    expect(percentWatched(120, 100)).toBe(100);
  });
});
