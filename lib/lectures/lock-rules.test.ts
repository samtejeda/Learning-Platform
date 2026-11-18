import { describe, expect, it } from "vitest";
import { evaluateLocks, isCleared, type LockInput } from "./lock-rules";

// Compact builder: a lecture with a question gets `q`, anything else is plain.
const L = (id: string, over: Partial<LockInput> = {}): LockInput => ({
  id,
  questionEnabled: false,
  started: false,
  completed: false,
  question: "open",
  unlocked: false,
  ...over,
});
const Q = (id: string, over: Partial<LockInput> = {}) => L(id, { questionEnabled: true, ...over });
const lockOf = (ordered: LockInput[], id: string) => evaluateLocks(ordered).get(id);

describe("evaluateLocks: the basic rule", () => {
  it("the first lecture is never locked, with or without a question", () => {
    expect(lockOf([Q("a"), L("b")], "a")).toBeNull();
    expect(lockOf([L("a"), L("b")], "a")).toBeNull();
  });

  it("a course with no questions never locks anything", () => {
    const m = evaluateLocks([L("a"), L("b"), L("c"), L("d")]);
    expect([...m.values()]).toEqual([null, null, null, null]);
  });

  it("a lecture after one WITHOUT an enabled question is not locked (even if that one is unwatched)", () => {
    expect(lockOf([L("a"), L("b")], "b")).toBeNull();
    // A written but switched-off question is `questionEnabled: false`.
    expect(lockOf([L("a", { question: "blocked" }), L("b")], "b")).toBeNull();
  });

  it("locks the next lecture while the previous one is not completed (not completed = not cleared)", () => {
    expect(lockOf([Q("a"), L("b")], "b")).toEqual({
      reason: "previous_not_completed",
      afterLectureId: "a",
      cause: "previous_not_completed",
    });
  });

  it("completed but unanswered or mid-retry is 'pending'", () => {
    for (const question of ["open", "retry"] as const) {
      expect(lockOf([Q("a", { completed: true, question }), L("b")], "b")).toMatchObject({
        reason: "previous_question_pending",
        afterLectureId: "a",
      });
    }
  });

  it("two wrong attempts is 'blocked' (contact the teacher)", () => {
    expect(lockOf([Q("a", { completed: true, question: "blocked" }), L("b")], "b")).toEqual({
      reason: "previous_question_blocked",
      afterLectureId: "a",
      cause: "previous_question_blocked",
    });
  });

  it("passing on either attempt opens the next lecture", () => {
    expect(lockOf([Q("a", { completed: true, question: "passed" }), L("b")], "b")).toBeNull();
  });

  it("a professor unlock opens it, whether the student was blocked, mid-retry or never answered", () => {
    for (const question of ["blocked", "retry", "open"] as const) {
      expect(lockOf([Q("a", { completed: true, question, unlocked: true }), L("b")], "b")).toBeNull();
    }
  });

  it("an unlock counts as cleared but attempts are not rewritten (the status input is untouched)", () => {
    const blockedThenUnlocked = { question: "blocked", unlocked: true } as const;
    expect(isCleared(blockedThenUnlocked)).toBe(true);
    expect(isCleared({ question: "blocked", unlocked: false })).toBe(false);
    expect(isCleared({ question: "retry", unlocked: false })).toBe(false);
    expect(isCleared({ question: "passed", unlocked: false })).toBe(true);
  });
});

describe("evaluateLocks: the mid-course exemption", () => {
  it("a lecture the student already started is never locked", () => {
    for (const question of ["open", "retry", "blocked"] as const) {
      expect(lockOf([Q("a", { completed: false, question }), L("b", { started: true })], "b")).toBeNull();
    }
  });

  it("the exemption is per lecture: the one after a started lecture is judged on its own predecessor", () => {
    const course = [Q("a"), Q("b", { started: true }), L("c")];
    expect(lockOf(course, "b")).toBeNull();
    expect(lockOf(course, "c")).toMatchObject({ reason: "previous_not_completed", afterLectureId: "b" });
  });
});

describe("evaluateLocks: chains (a locked lecture cannot be skipped)", () => {
  it("a lecture after a locked lecture is locked even if that lecture has no question", () => {
    const course = [Q("a"), L("b"), L("c"), L("d")];
    const m = evaluateLocks(course);
    expect(m.get("b")).toMatchObject({ reason: "previous_not_completed", afterLectureId: "a" });
    expect(m.get("c")).toEqual({ reason: "previous_locked", afterLectureId: "a", cause: "previous_not_completed" });
    expect(m.get("d")).toEqual({ reason: "previous_locked", afterLectureId: "a", cause: "previous_not_completed" });
  });

  it("the chain carries the root cause, so a blocked root still says 'contact your teacher'", () => {
    const m = evaluateLocks([Q("a", { completed: true, question: "blocked" }), L("b"), L("c")]);
    expect(m.get("c")).toEqual({ reason: "previous_locked", afterLectureId: "a", cause: "previous_question_blocked" });
  });

  it("clearing the root opens the whole chain", () => {
    const m = evaluateLocks([Q("a", { completed: true, question: "passed" }), L("b"), L("c")]);
    expect([...m.values()]).toEqual([null, null, null]);
  });

  it("a started lecture breaks the chain for itself and for what follows it", () => {
    const m = evaluateLocks([Q("a"), L("b"), L("c", { started: true }), L("d")]);
    expect(m.get("b")).not.toBeNull();
    expect(m.get("c")).toBeNull();
    expect(m.get("d")).toBeNull(); // c is open and has no question
  });

  it("a later question locks again after an earlier one was cleared", () => {
    const m = evaluateLocks([Q("a", { completed: true, question: "passed" }), Q("b"), L("c")]);
    expect(m.get("b")).toBeNull();
    expect(m.get("c")).toMatchObject({ reason: "previous_not_completed", afterLectureId: "b" });
  });
});

describe("evaluateLocks: changes are just different inputs (nothing is stored)", () => {
  const base = (over: Partial<Record<string, Partial<LockInput>>> = {}) => [
    Q("a", { completed: true, question: "passed", ...over.a }),
    Q("b", over.b),
    L("c", over.c),
  ];

  it("turning a question OFF removes the lock it caused, ON restores it (attempts kept)", () => {
    const failing = { completed: true, question: "blocked" } as const;
    expect(lockOf(base({ b: { ...failing } }), "c")).toMatchObject({ reason: "previous_question_blocked" });
    expect(lockOf(base({ b: { ...failing, questionEnabled: false } }), "c")).toBeNull();
    expect(lockOf(base({ b: { ...failing, questionEnabled: true } }), "c")).toMatchObject({ reason: "previous_question_blocked" });
  });

  it("a pass stays a pass however the question is edited later (the input is the stored attempt status)", () => {
    expect(lockOf(base({ b: { completed: true, question: "passed" } }), "c")).toBeNull();
  });

  it("reordering re-evaluates: swapping b and c moves the lock", () => {
    const b = Q("b");
    const c = L("c");
    expect(lockOf([Q("a", { completed: true, question: "passed" }), b, c], "c")).not.toBeNull();
    expect(lockOf([Q("a", { completed: true, question: "passed" }), c, b], "c")).toBeNull();
    expect(lockOf([Q("a", { completed: true, question: "passed" }), c, b], "b")).toBeNull(); // c has no question
  });

  it("an unpublished lecture is simply absent: its successor is judged on the previous PUBLISHED one", () => {
    const withMiddle = [Q("a"), Q("m", { started: true, completed: true, question: "passed" }), L("c")];
    expect(lockOf(withMiddle, "c")).toBeNull();
    const withoutMiddle = [Q("a"), L("c")];
    expect(lockOf(withoutMiddle, "c")).toMatchObject({ reason: "previous_not_completed", afterLectureId: "a" });
  });

  it("never carries any question text or key, only a reason, a lecture id and a cause", () => {
    const lock = lockOf([Q("a"), L("b")], "b")!;
    expect(Object.keys(lock).sort()).toEqual(["afterLectureId", "cause", "reason"]);
  });
});
