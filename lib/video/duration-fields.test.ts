import { describe, expect, it } from "vitest";
import { combineDuration, durationFieldMessage, splitDuration } from "./duration-fields";

describe("splitDuration", () => {
  it("splits seconds into minutes and seconds", () => {
    expect(splitDuration(2730)).toEqual({ minutes: "45", seconds: "30" });
    expect(splitDuration(59)).toEqual({ minutes: "0", seconds: "59" });
    expect(splitDuration(3600)).toEqual({ minutes: "60", seconds: "0" });
  });
  it("rounds fractional seconds", () => {
    expect(splitDuration(214.4)).toEqual({ minutes: "3", seconds: "34" });
  });
  it("leaves both boxes blank for nothing usable", () => {
    for (const v of [null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(splitDuration(v)).toEqual({ minutes: "", seconds: "" });
    }
  });
});

describe("combineDuration", () => {
  it("combines the two boxes", () => {
    expect(combineDuration("45", "30")).toBe(2730);
    expect(combineDuration("90", "")).toBe(5400);
    expect(combineDuration("", "45")).toBe(45);
  });
  it("is null when blank, malformed or out of range", () => {
    expect(combineDuration("", "")).toBeNull();
    expect(combineDuration("  ", " ")).toBeNull();
    expect(combineDuration("1.5", "0")).toBeNull();
    expect(combineDuration("-1", "0")).toBeNull();
    expect(combineDuration("1e2", "0")).toBeNull();
    expect(combineDuration("abc", "0")).toBeNull();
    expect(combineDuration("1", "60")).toBeNull();
    expect(combineDuration("0", "0")).toBeNull();
    expect(combineDuration("1441", "0")).toBeNull();
    expect(combineDuration("1440", "1")).toBeNull();
  });
  it("accepts the 24 hour limit exactly", () => {
    expect(combineDuration("1440", "0")).toBe(86400);
  });
});

describe("durationFieldMessage", () => {
  it("says nothing for blank or valid input", () => {
    expect(durationFieldMessage("", "")).toBeNull();
    expect(durationFieldMessage("45", "30")).toBeNull();
  });
  it("explains each problem plainly", () => {
    expect(durationFieldMessage("x", "0")).toMatch(/whole numbers/);
    expect(durationFieldMessage("1", "75")).toMatch(/between 0 and 59/);
    expect(durationFieldMessage("2000", "0")).toMatch(/implausibly long/);
    expect(durationFieldMessage("0", "0")).toMatch(/at least one second/);
  });
});
