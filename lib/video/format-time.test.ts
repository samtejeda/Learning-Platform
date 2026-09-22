import { describe, expect, it } from "vitest";
import { formatTime } from "./format-time";

describe("formatTime", () => {
  it("formats minutes and seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(75)).toBe("1:15");
    expect(formatTime(599.9)).toBe("9:59");
  });
  it("adds hours when needed", () => {
    expect(formatTime(3725)).toBe("1:02:05");
  });
  it("handles junk", () => {
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(-5)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
  });
});
