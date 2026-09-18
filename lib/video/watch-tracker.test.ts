import { describe, expect, it } from "vitest";
import {
  addInterval,
  applyTimeUpdate,
  clampSeek,
  frontier,
  intervalsFromWatchedSeconds,
  isSeekAllowed,
  mergeIntervals,
  totalWatched,
  watchedPercent,
  type Interval,
} from "./watch-tracker";

describe("mergeIntervals", () => {
  it("merges overlapping and touching ranges and sorts them", () => {
    expect(mergeIntervals([[5, 10], [0, 5], [12, 15], [14, 20]])).toEqual([[0, 10], [12, 20]]);
  });
  it("drops empty, inverted and non-finite ranges", () => {
    expect(mergeIntervals([[3, 3], [10, 4], [NaN, 5], [1, Infinity], [0, 2]])).toEqual([[0, 2]]);
  });
  it("clamps negative starts to 0", () => {
    expect(mergeIntervals([[-1, 2]])).toEqual([[0, 2]]);
  });
});

describe("addInterval", () => {
  it("adds a new range and merges it", () => {
    expect(addInterval([[0, 4]], 3, 8)).toEqual([[0, 8]]);
  });
  it("ignores a zero-length range", () => {
    expect(addInterval([[0, 4]], 6, 6)).toEqual([[0, 4]]);
  });
});

describe("applyTimeUpdate", () => {
  it("records a small forward step as watched", () => {
    expect(applyTimeUpdate([], 0, 0.25)).toEqual([[0, 0.25]]);
  });
  it("accumulates consecutive ticks into one range", () => {
    let iv: Interval[] = [];
    for (let t = 0; t < 10; t += 0.25) iv = applyTimeUpdate(iv, t, t + 0.25);
    expect(iv).toEqual([[0, 10]]);
    expect(totalWatched(iv)).toBeCloseTo(10);
  });
  it("ignores a jump larger than the max step (a seek)", () => {
    expect(applyTimeUpdate([[0, 5]], 5, 60)).toEqual([[0, 5]]);
  });
  it("ignores backwards movement", () => {
    expect(applyTimeUpdate([[0, 5]], 5, 2)).toEqual([[0, 5]]);
  });
  it("accepts a step exactly at the max", () => {
    expect(applyTimeUpdate([], 0, 2)).toEqual([[0, 2]]);
  });
  it("does not double-count a rewatched region", () => {
    const iv = applyTimeUpdate([[0, 10]], 4, 4.5);
    expect(totalWatched(iv)).toBe(10);
  });
});

describe("frontier / totalWatched / watchedPercent", () => {
  it("frontier is the furthest end", () => {
    expect(frontier([[0, 5], [20, 30], [8, 9]])).toBe(30);
    expect(frontier([])).toBe(0);
  });
  it("totalWatched sums merged ranges only", () => {
    expect(totalWatched([[0, 5], [3, 8], [10, 12]])).toBe(10);
  });
  it("watchedPercent is clamped and 0 without a duration", () => {
    expect(watchedPercent([[0, 95]], 100)).toBe(95);
    expect(watchedPercent([[0, 150]], 100)).toBe(100);
    expect(watchedPercent([[0, 5]], 0)).toBe(0);
    expect(watchedPercent([[0, 5]], NaN)).toBe(0);
  });
});

describe("seek rules", () => {
  it("allows backward seeks and seeks within the watched region", () => {
    expect(isSeekAllowed(3, 10)).toBe(true);
    expect(isSeekAllowed(10, 10)).toBe(true);
  });
  it("allows a forward seek only within the tolerance", () => {
    expect(isSeekAllowed(11.9, 10)).toBe(true);
    expect(isSeekAllowed(12.1, 10)).toBe(false);
  });
  it("clampSeek snaps a rejected seek back to the frontier", () => {
    expect(clampSeek(50, 10)).toBe(10);
    expect(clampSeek(4, 10)).toBe(4);
    expect(clampSeek(-3, 10)).toBe(0);
  });
});

describe("intervalsFromWatchedSeconds", () => {
  it("reconstructs a single range from 0", () => {
    expect(intervalsFromWatchedSeconds(42)).toEqual([[0, 42]]);
    expect(intervalsFromWatchedSeconds(0)).toEqual([]);
  });
});
