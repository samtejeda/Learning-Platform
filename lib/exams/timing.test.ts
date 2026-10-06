import { describe, expect, it } from "vitest";
import { attemptDeadline, closeTimeFor, isPastDeadline, isPastGrace, SUBMIT_GRACE_SECONDS } from "./timing";

const start = new Date("2026-01-01T10:00:00Z");
const at = (sec: number) => new Date(start.getTime() + sec * 1000);

describe("attempt timing", () => {
  it("deadline is start + duration", () => {
    expect(attemptDeadline(start, 20).toISOString()).toBe("2026-01-01T10:20:00.000Z");
  });
  it("deadline vs grace", () => {
    expect(isPastDeadline(at(1200), start, 20)).toBe(false);
    expect(isPastDeadline(at(1201), start, 20)).toBe(true);
    expect(isPastGrace(at(1200 + SUBMIT_GRACE_SECONDS), start, 20)).toBe(false);
    expect(isPastGrace(at(1200 + SUBMIT_GRACE_SECONDS + 1), start, 20)).toBe(true);
  });
  it("closes at real time if on time, else at the deadline", () => {
    expect(closeTimeFor(at(600), start, 20)).toEqual(at(600));
    expect(closeTimeFor(at(5000), start, 20)).toEqual(at(1200));
  });
});
