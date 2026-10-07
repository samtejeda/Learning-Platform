import { describe, expect, it } from "vitest";
import { BLANK_TOKEN } from "@/lib/exams/blanks";
import { blankCount, canInsertBlank, fromSegments, insertBlank, removeBlank, stripToken, toSegments } from "./prompt-blanks";

describe("prompt blanks", () => {
  it("round-trips a prompt through segments", () => {
    const p = `a${BLANK_TOKEN}b${BLANK_TOKEN}c`;
    expect(toSegments(p)).toEqual(["a", "b", "c"]);
    expect(fromSegments(toSegments(p))).toBe(p);
    expect(toSegments(null)).toEqual([""]);
    expect(blankCount(toSegments(p))).toBe(2);
  });

  it("inserts a blank at the cursor and reports where to focus", () => {
    const r = insertBlank(["hello world"], 0, 5);
    expect(r.segments).toEqual(["hello", " world"]);
    expect(r.focusSegment).toBe(1);
    expect(fromSegments(r.segments)).toBe(`hello${BLANK_TOKEN} world`);
  });

  it("clamps an out-of-range cursor and segment", () => {
    expect(insertBlank(["ab"], 0, 99).segments).toEqual(["ab", ""]);
    expect(insertBlank(["ab"], 7, -3).segments).toEqual(["", "ab"]);
  });

  it("removes a blank and joins the text around it", () => {
    expect(removeBlank(["a", "b", "c"], 0)).toEqual(["ab", "c"]);
    expect(removeBlank(["a", "b", "c"], 1)).toEqual(["a", "bc"]);
    expect(removeBlank(["a", "b"], 5)).toEqual(["a", "b"]);
  });

  it("never lets the token be typed or pasted", () => {
    expect(stripToken(`x${BLANK_TOKEN}y`)).toBe("xy");
  });

  it("stops at the maximum number of blanks", () => {
    expect(canInsertBlank(Array(20).fill(""))).toBe(true); // 19 blanks
    expect(canInsertBlank(Array(21).fill(""))).toBe(false); // 20 blanks
  });
});
