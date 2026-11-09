import { describe, expect, it } from "vitest";
import { applyResponse, attemptsLeftText, checkErrorMessage, parseCheckResponse, type CardQuestion } from "./comprehension-view";

const q: CardQuestion = {
  es: { prompt: "Question 1", options: ["a", "b", "c"] },
  en: { prompt: "Question 1", options: ["A", "B", "C"] },
};

describe("parseCheckResponse", () => {
  it("accepts the route's shape", () => {
    expect(parseCheckResponse({ correct: false, status: "retry", attemptsRemaining: 1, nextQuestion: q })).not.toBeNull();
    expect(parseCheckResponse({ correct: true, status: "passed", attemptsRemaining: 0, nextQuestion: null })).not.toBeNull();
  });
  it("rejects anything else", () => {
    expect(parseCheckResponse(null)).toBeNull();
    expect(parseCheckResponse({ correct: "yes", status: "retry", attemptsRemaining: 1, nextQuestion: null })).toBeNull();
    expect(parseCheckResponse({ correct: false, status: "weird", attemptsRemaining: 1, nextQuestion: null })).toBeNull();
    expect(parseCheckResponse({ correct: false, status: "retry", attemptsRemaining: 1, nextQuestion: { es: {} } })).toBeNull();
  });
});

describe("applyResponse", () => {
  it("a wrong first answer shows the next question and the notice", () => {
    const s = applyResponse({ correct: false, status: "retry", attemptsRemaining: 1, nextQuestion: q });
    expect(s).toMatchObject({ status: "retry", attemptsRemaining: 1, lastWrong: true, answeredNow: true });
    expect(s.question).toBe(q);
  });
  it("a right answer leaves no question", () => {
    const s = applyResponse({ correct: true, status: "passed", attemptsRemaining: 0, nextQuestion: q });
    expect(s).toMatchObject({ status: "passed", lastWrong: false, question: null });
  });
  it("a wrong last answer is blocked with no question", () => {
    const s = applyResponse({ correct: false, status: "blocked", attemptsRemaining: 0, nextQuestion: null });
    expect(s).toMatchObject({ status: "blocked", lastWrong: true, question: null });
  });
});

describe("messages", () => {
  it("pluralises attempts", () => {
    expect(attemptsLeftText(1)).toBe("You have 1 attempt left.");
    expect(attemptsLeftText(2)).toBe("You have 2 attempts left.");
  });
  it("maps each documented error", () => {
    expect(checkErrorMessage(409, "not_completed")).toMatchObject({ resync: true });
    expect(checkErrorMessage(409, "already_passed").message).toMatch(/already answered/);
    expect(checkErrorMessage(409, "no_attempts_left").message).toMatch(/no attempts left/);
    expect(checkErrorMessage(409, "conflict").resync).toBe(true);
    expect(checkErrorMessage(429, null).resync).toBe(false);
    expect(checkErrorMessage(404, "not_found").resync).toBe(true);
    expect(checkErrorMessage(500, null).message).toMatch(/couldn't check/);
  });
  it("never promises an unlock or a consequence", () => {
    const all = [409, 429, 404, 500].flatMap((s) => ["not_completed", "already_passed", "no_attempts_left", "conflict", null].map((c) => checkErrorMessage(s, c).message));
    for (const m of all) expect(m).not.toMatch(/unlock|teacher|professor|locked|blocked/i);
  });
});
