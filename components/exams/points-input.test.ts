import { describe, expect, it } from "vitest";
import { checkPoints, runningTotal } from "./points-input";

describe("points input", () => {
  it("accepts whole and half points up to the question's weight", () => {
    expect(checkPoints("2", 5)).toEqual({ value: 2, error: null });
    expect(checkPoints("2.5", 5)).toEqual({ value: 2.5, error: null });
    expect(checkPoints("0", 5).value).toBe(0);
  });

  it("explains what is wrong", () => {
    expect(checkPoints("", 5).error).toMatch(/Enter/);
    expect(checkPoints("abc", 5).error).toMatch(/number/);
    expect(checkPoints("-1", 5).error).toMatch(/negative/);
    expect(checkPoints("2.3", 5).error).toMatch(/half/);
    expect(checkPoints("6", 5).error).toMatch(/more than 5/);
  });

  it("keeps a running total and counts what is still missing", () => {
    const t = runningTotal(3, [checkPoints("2", 5), checkPoints("", 5), checkPoints("1.5", 2)]);
    expect(t).toEqual({ points: 6.5, missing: 1 });
  });
});
