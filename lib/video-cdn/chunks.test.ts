import { describe, expect, it } from "vitest";
import { CHUNK_BYTES, chunkBounds, parseRangeHeader, planResponse, resolveRange } from "./chunks";

const TOTAL = 20 * 1024 * 1024 + 5; // 2 full chunks + a 4 MiB+5 tail

describe("parseRangeHeader", () => {
  it("parses the three single-range forms", () => {
    expect(parseRangeHeader("bytes=0-")).toEqual({ kind: "from", start: 0, end: null });
    expect(parseRangeHeader("bytes=10-99")).toEqual({ kind: "from", start: 10, end: 99 });
    expect(parseRangeHeader("bytes=-500")).toEqual({ kind: "suffix", length: 500 });
  });
  it("treats absent as null and garbage/multi-range/reversed as invalid", () => {
    expect(parseRangeHeader(null)).toBeNull();
    for (const bad of ["bytes=-", "bytes=0-1,5-9", "items=0-1", "bytes=9-1", "bytes=-0", "bytes=a-b"]) {
      expect(parseRangeHeader(bad)).toBe("invalid");
    }
  });
});

describe("resolveRange", () => {
  it("clamps to the file and handles suffix", () => {
    expect(resolveRange({ kind: "from", start: 5, end: 10 ** 12 }, TOTAL)).toEqual({ start: 5, end: TOTAL - 1 });
    expect(resolveRange({ kind: "suffix", length: 100 }, TOTAL)).toEqual({ start: TOTAL - 100, end: TOTAL - 1 });
    expect(resolveRange({ kind: "suffix", length: 10 ** 12 }, TOTAL)).toEqual({ start: 0, end: TOTAL - 1 });
    expect(resolveRange(null, TOTAL)).toEqual({ start: 0, end: TOTAL - 1 });
  });
  it("is unsatisfiable past the end", () => {
    expect(resolveRange({ kind: "from", start: TOTAL, end: null }, TOTAL)).toBeNull();
    expect(resolveRange(null, 0)).toBeNull();
  });
});

describe("chunking", () => {
  it("computes aligned bounds, with a short tail", () => {
    expect(chunkBounds(0, TOTAL)).toEqual({ start: 0, end: CHUNK_BYTES - 1 });
    expect(chunkBounds(2, TOTAL)).toEqual({ start: 2 * CHUNK_BYTES, end: TOTAL - 1 });
  });

  it("answers an open-ended range from the first chunk only", () => {
    const p = planResponse({ start: 0, end: TOTAL - 1 }, TOTAL);
    expect(p).toMatchObject({ chunkIndex: 0, start: 0, end: CHUNK_BYTES - 1, offset: 0, length: CHUNK_BYTES });
  });

  it("slices inside a chunk and clamps at its end when a range crosses a boundary", () => {
    const start = CHUNK_BYTES + 100;
    const p = planResponse({ start, end: start + 3 * CHUNK_BYTES }, TOTAL);
    expect(p.chunkIndex).toBe(1);
    expect(p.offset).toBe(100);
    expect(p.end).toBe(2 * CHUNK_BYTES - 1);
    expect(p.length).toBe(CHUNK_BYTES - 100);
  });

  it("returns exactly the requested bytes for a small range", () => {
    expect(planResponse({ start: 1000, end: 1999 }, TOTAL)).toMatchObject({ chunkIndex: 0, offset: 1000, length: 1000 });
  });

  it("handles the final short chunk", () => {
    const p = planResponse({ start: TOTAL - 3, end: TOTAL - 1 }, TOTAL);
    expect(p).toMatchObject({ chunkIndex: 2, end: TOTAL - 1, length: 3 });
  });
});
