import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { actAs } from "@/test/setup-integration";
import { resetSeedData, SEED, seedUsers } from "@/test/seed";
import { db } from "@/lib/db";
import { lectureComprehensionAttempts, lectureProgress, lectures, rateLimitBuckets } from "@/lib/db/schema";
import { insertCourse } from "@/lib/data/courses";
import { inviteByEmail } from "@/lib/data/enrollments";
import { insertLecture, listLecturesForProfessor, markLectureUploaded, setLecturePublished } from "@/lib/data/lectures";
import { getComprehensionForStudent, getOwnedComprehension } from "@/lib/data/lecture-comprehension";
import {
  disableLectureComprehension,
  enableLectureComprehension,
  publishLecture,
  saveLectureComprehension,
  unpublishLecture,
} from "@/lib/lectures/actions";
import { POST as comprehensionPOST } from "@/app/api/lectures/[lectureId]/comprehension/route";
import { AuthError } from "@/lib/auth/session";
import { bucketKey, RATE_LIMITS } from "@/lib/rate-limit/policy";

// The shared dev database is remote; each action is several round trips.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

// Placeholders only: the professor's real wording is never authored here.
const ORIGIN = "http://localhost:3000";
const A = { id: SEED.profA.id, role: "professor" as const };
const ctx = (lectureId: string) => ({ params: Promise.resolve({ lectureId }) });
const answer = (lectureId: string, body: unknown, headers: Record<string, string> = {}) =>
  comprehensionPOST(
    new NextRequest(`${ORIGIN}/api/lectures/${lectureId}/comprehension`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    ctx(lectureId),
  );

const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const q = (n: 1 | 2, key = "2") => ({
  [`q${n}PromptEs`]: `Question ${n} (es)`,
  [`q${n}PromptEn`]: `Question ${n} (en)`,
  [`q${n}OptionsEs`]: "Option A (es)\nOption B (es)\nOption C (es)",
  [`q${n}OptionsEn`]: "Option A (en)\nOption B (en)\nOption C (en)",
  [`q${n}Correct`]: key,
});
const save = (lectureId: string, fields: Record<string, string>) => saveLectureComprehension(lectureId, null, fd(fields));

/** Every key anywhere in a JSON-able value. */
function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      allKeys(x, out);
    }
  }
  return out;
}
const hasNoKey = (v: unknown) => {
  const keys = [...allKeys(v)].map((k) => k.toLowerCase());
  expect(keys.some((k) => k.includes("correct") && k !== "correct")).toBe(false);
  expect(keys).not.toContain("correctoption");
  expect(keys).not.toContain("correct_option");
  expect(keys).not.toContain("answer");
};

let courseId: string;
let n = 0;
async function newLecture(opts: { publish?: boolean } = { publish: true }) {
  const id = `c0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  await insertLecture({ id, courseId, title: `Lecture ${n}`, description: null, videoStoragePath: `courses/${courseId}/lectures/${id}/video.mp4` });
  await markLectureUploaded(id, 100);
  if (opts.publish !== false) await setLecturePublished(id, true);
  return id;
}
async function complete(lectureId: string, studentId: string) {
  await db
    .insert(lectureProgress)
    .values({ studentId, lectureId, completed: true, completedAt: new Date(), watchedSeconds: 100 })
    .onConflictDoNothing();
}
async function ready(fields: Record<string, string>) {
  const id = await newLecture();
  actAs(SEED.profA.id);
  expect(await save(id, fields)).toEqual({ success: "Comprehension question saved." });
  expect(await enableLectureComprehension(id)).toEqual({ success: "Comprehension question turned on." });
  return id;
}

describe("comprehension question: professor actions", () => {
  beforeAll(async () => {
    await seedUsers();
    await resetSeedData();
    ({ id: courseId } = await insertCourse({ title: "Comprehension test", description: null, professorId: SEED.profA.id }));
    await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);
  });
  afterAll(async () => {
    await resetSeedData();
  });

  it("students cannot use any professor action", async () => {
    const id = await newLecture();
    actAs(SEED.student.id);
    await expect(save(id, q(1))).rejects.toBeInstanceOf(AuthError);
    await expect(enableLectureComprehension(id)).rejects.toBeInstanceOf(AuthError);
    await expect(disableLectureComprehension(id)).rejects.toBeInstanceOf(AuthError);
    actAs(null);
    await expect(save(id, q(1))).rejects.toBeInstanceOf(AuthError);
  });

  it("another professor gets 'not found' and nothing changes", async () => {
    const id = await newLecture();
    actAs(SEED.profA.id);
    await save(id, q(1));
    actAs(SEED.profB.id);
    expect(await save(id, { ...q(1), q1PromptEs: "Changed" })).toEqual({ error: "Lecture not found." });
    expect(await enableLectureComprehension(id)).toEqual({ error: "Lecture not found." });
    expect(await disableLectureComprehension(id)).toEqual({ error: "Lecture not found." });
    expect(await save("not-a-uuid", q(1))).toEqual({ error: "Lecture not found." });
    expect(await getOwnedComprehension(id, { id: SEED.profB.id, role: "professor" })).toBeNull();
    const mine = await getOwnedComprehension(id, A);
    expect(mine!.questions[0].promptEs).toBe("Question 1 (es)");
    expect(mine!.enabled).toBe(false);
  });

  it("an admin may manage any course's question", async () => {
    const id = await newLecture();
    actAs(SEED.admin.id);
    expect(await save(id, q(1))).toEqual({ success: "Comprehension question saved." });
    expect(await enableLectureComprehension(id)).toEqual({ success: "Comprehension question turned on." });
  });

  it("drafts may be incomplete, but enabling needs both languages", async () => {
    const id = await newLecture();
    actAs(SEED.profA.id);
    // Spanish only: fine as a draft.
    expect(await save(id, { q1PromptEs: "Question 1 (es)", q1OptionsEs: "Option A\nOption B\nOption C", q1Correct: "0" })).toEqual({
      success: "Comprehension question saved.",
    });
    const refused = await enableLectureComprehension(id);
    expect(refused?.error).toMatch(/isn't complete/);
    expect(refused?.error).toMatch(/Add the English question/);
    expect((await getOwnedComprehension(id, A))!.enabled).toBe(false);
    // Complete both languages: enabling now works.
    await save(id, q(1));
    expect(await enableLectureComprehension(id)).toEqual({ success: "Comprehension question turned on." });
    expect((await getOwnedComprehension(id, A))!.enabled).toBe(true);
    expect((await listLecturesForProfessor(courseId)).find((l) => l.id === id)!.comprehensionEnabled).toBe(true);
  });

  it("enabling needs at least 3 options and a key", async () => {
    const id = await newLecture();
    actAs(SEED.profA.id);
    await save(id, { ...q(1), q1OptionsEs: "Option A\nOption B", q1OptionsEn: "Option A\nOption B", q1Correct: "1" });
    expect((await enableLectureComprehension(id))?.error).toMatch(/3–6/);
    await save(id, { ...q(1), q1Correct: "" });
    expect((await enableLectureComprehension(id))?.error).toMatch(/correct answer/);
  });

  it("turning it off keeps the written question; turning it on again loses nothing", async () => {
    const id = await ready({ ...q(1), ...q(2, "0") });
    expect(await disableLectureComprehension(id)).toEqual({ success: "Comprehension question turned off." });
    const off = await getOwnedComprehension(id, A);
    expect(off!.enabled).toBe(false);
    expect(off!.questions.map((x) => x.slot)).toEqual([1, 2]);
    expect(off!.questions[0].correctOption).toBe(2);
    expect(off!.questions[1].correctOption).toBe(0);
    expect(await enableLectureComprehension(id)).toEqual({ success: "Comprehension question turned on." });
    expect((await getOwnedComprehension(id, A))!.questions).toEqual(off!.questions);
  });

  it("while enabled, an edit that would leave it incomplete is rejected and nothing changes", async () => {
    const id = await ready(q(1));
    const before = await getOwnedComprehension(id, A);
    const r = await save(id, { ...q(1), q1PromptEn: "" });
    expect(r?.error).toMatch(/Add the English question/);
    const after = await getOwnedComprehension(id, A);
    expect(after).toEqual(before);
    expect(after!.enabled).toBe(true); // never auto-disabled
  });

  it("a half-written second question blocks enabling, an empty one does not", async () => {
    const id = await newLecture();
    actAs(SEED.profA.id);
    await save(id, { ...q(1), q2PromptEs: "Question 2 (es)" });
    expect((await enableLectureComprehension(id))?.error).toMatch(/Question 2/);
    await save(id, q(1)); // slot 2 left empty removes its row
    expect((await getOwnedComprehension(id, A))!.questions.map((x) => x.slot)).toEqual([1]);
    expect(await enableLectureComprehension(id)).toEqual({ success: "Comprehension question turned on." });
  });

  it("rejects structurally unsafe input (positions must not shift)", async () => {
    const id = await newLecture();
    actAs(SEED.profA.id);
    expect((await save(id, { ...q(1), q1OptionsEs: "Option A (es)\n\nOption C (es)" }))?.fieldErrors?.q1OptionsEs).toBeTruthy();
    expect((await save(id, { ...q(1), q1OptionsEn: "Option A\nOption B\nOption C\nOption D" }))?.error).toMatch(/same number of options/);
    expect((await save(id, { ...q(1), q1Correct: "3" }))?.error).toMatch(/must be one of the options/);
    expect((await save(id, { ...q(1), q1Correct: "9" }))?.fieldErrors?.q1Correct).toBeTruthy();
    expect((await getOwnedComprehension(id, A))!.questions).toHaveLength(0);
  });

  it("publish is refused while an enabled question is incomplete, at the action and at the data layer", async () => {
    const id = await newLecture({ publish: false });
    // The only way to reach enabled-but-incomplete is a direct write; the gate must still hold.
    await db.update(lectures).set({ comprehensionEnabled: true }).where(eq(lectures.id, id));
    actAs(SEED.profA.id);
    expect((await publishLecture(id))?.error).toMatch(/comprehension question/);
    expect(await setLecturePublished(id, true)).toBe(false);
    const [row] = await db.select({ p: lectures.publishedAt }).from(lectures).where(eq(lectures.id, id));
    expect(row.p).toBeNull();
    await save(id, q(1));
    expect(await publishLecture(id)).toEqual({ success: "Published." });
    expect(await unpublishLecture(id)).toEqual({ success: "Unpublished." });
  });

  it("a lecture with the question disabled publishes with nothing written", async () => {
    const id = await newLecture({ publish: false });
    actAs(SEED.profA.id);
    expect(await publishLecture(id)).toEqual({ success: "Published." });
  });
});

describe("comprehension question: student route", () => {
  let twoQ: string;
  let oneQ: string;

  beforeAll(async () => {
    await seedUsers();
    await resetSeedData();
    ({ id: courseId } = await insertCourse({ title: "Comprehension route test", description: null, professorId: SEED.profA.id }));
    await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);
    twoQ = await ready({ ...q(1, "2"), ...q(2, "0") });
    oneQ = await ready(q(1, "1"));
  });
  afterAll(async () => {
    await resetSeedData();
  });

  it("is signed-in only, same-origin only, and validates the id and body", async () => {
    actAs(null);
    expect((await answer(twoQ, { selectedOption: 0 })).status).toBe(401);
    actAs(SEED.student.id);
    expect((await answer(twoQ, { selectedOption: 0 }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await answer("not-a-uuid", { selectedOption: 0 })).status).toBe(404);
    expect((await answer(twoQ, "{nope")).status).toBe(400);
    for (const bad of [{}, { selectedOption: "1" }, { selectedOption: -1 }, { selectedOption: 1.5 }, { selectedOption: 6 }, { selectedOption: 0, extra: 1 }, { answer: "text" }]) {
      expect((await answer(twoQ, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("is 404 for everyone without access, and the same 404 each time", async () => {
    await complete(twoQ, SEED.student2.id);
    const draftLecture = await newLecture({ publish: false });
    actAs(SEED.profA.id);
    await save(draftLecture, q(1));
    await enableLectureComprehension(draftLecture);
    const disabled = await newLecture();
    actAs(SEED.profA.id);
    await save(disabled, q(1)); // written but never enabled
    const off = await ready(q(1));
    await disableLectureComprehension(off);
    for (const id of [draftLecture, disabled, off]) await complete(id, SEED.student.id);

    const bodies: unknown[] = [];
    for (const [actor, id] of [
      [SEED.student2.id, twoQ], // not enrolled
      [SEED.student.id, draftLecture], // unpublished
      [SEED.student.id, disabled], // question never enabled
      [SEED.student.id, off], // enabled, then disabled (text kept)
      [SEED.student.id, "d0000000-0000-4000-8000-000000000999"], // unknown
      [SEED.profA.id, twoQ], // the owning professor is not a student
      [SEED.admin.id, twoQ],
    ] as const) {
      actAs(actor);
      const res = await answer(id, { selectedOption: 0 });
      expect(res.status, `${actor} → ${id}`).toBe(404);
      bodies.push(await res.json());
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(await getComprehensionForStudent(twoQ, SEED.student2.id)).toBeNull();
    expect(await getComprehensionForStudent(draftLecture, SEED.student.id)).toBeNull();
    expect(await getComprehensionForStudent(off, SEED.student.id)).toBeNull();
    // Nothing was recorded for any refused call.
    expect(await db.select().from(lectureComprehensionAttempts)).toHaveLength(0);
  });

  it("cannot be answered before the lecture is completed, and the question isn't shown yet", async () => {
    actAs(SEED.student.id);
    const view = await getComprehensionForStudent(twoQ, SEED.student.id);
    expect(view).toMatchObject({ status: "open", lectureCompleted: false, question: null, attemptsRemaining: 2 });
    const res = await answer(twoQ, { selectedOption: 2 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("not_completed");
    expect(await db.select().from(lectureComprehensionAttempts)).toHaveLength(0);
  });

  it("first-attempt success passes, and no key reaches the student", async () => {
    await complete(twoQ, SEED.student.id);
    actAs(SEED.student.id);
    const before = await getComprehensionForStudent(twoQ, SEED.student.id);
    expect(before!.question).toEqual({
      es: { prompt: "Question 1 (es)", options: ["Option A (es)", "Option B (es)", "Option C (es)"] },
      en: { prompt: "Question 1 (en)", options: ["Option A (en)", "Option B (en)", "Option C (en)"] },
    });
    hasNoKey(before);
    const res = await answer(twoQ, { selectedOption: 2 });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ correct: true, status: "passed", attemptsRemaining: 0, nextQuestion: null });
    hasNoKey(body);
    // Recorded: attempt number, slot, right/wrong. Not the chosen option.
    const rows = await db.select().from(lectureComprehensionAttempts).where(eq(lectureComprehensionAttempts.lectureId, twoQ));
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["attemptNumber", "correct", "createdAt", "id", "lectureId", "questionSlot", "studentId"]);
    expect(rows[0]).toMatchObject({ attemptNumber: 1, questionSlot: 1, correct: true });
    // A further answer after passing is refused and records nothing.
    const again = await answer(twoQ, { selectedOption: 2 });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("already_passed");
    expect((await getComprehensionForStudent(twoQ, SEED.student.id))!.question).toBeNull();
  });

  it("two questions: a wrong first answer retries with the second question, a right second passes", async () => {
    const id = await ready({ ...q(1, "2"), ...q(2, "0"), q2PromptEs: "Question 2 (es)", q2PromptEn: "Question 2 (en)" });
    await complete(id, SEED.student.id);
    actAs(SEED.student.id);
    const first = await (await answer(id, { selectedOption: 0 })).json();
    expect(first).toMatchObject({ correct: false, status: "retry", attemptsRemaining: 1 });
    expect(first.nextQuestion.es.prompt).toBe("Question 2 (es)");
    expect(first.nextQuestion.en.prompt).toBe("Question 2 (en)");
    hasNoKey(first);
    const view = await getComprehensionForStudent(id, SEED.student.id);
    expect(view).toMatchObject({ status: "retry", attemptsUsed: 1 });
    expect(view!.question!.en.prompt).toBe("Question 2 (en)");
    // Key for question 2 is position 0; question 1's key (2) must not count.
    const second = await (await answer(id, { selectedOption: 0 })).json();
    expect(second).toMatchObject({ correct: true, status: "passed" });
    const rows = await db
      .select({ a: lectureComprehensionAttempts.attemptNumber, s: lectureComprehensionAttempts.questionSlot, c: lectureComprehensionAttempts.correct })
      .from(lectureComprehensionAttempts)
      .where(and(eq(lectureComprehensionAttempts.lectureId, id), eq(lectureComprehensionAttempts.studentId, SEED.student.id)));
    expect(rows.sort((x, y) => x.a - y.a)).toEqual([{ a: 1, s: 1, c: false }, { a: 2, s: 2, c: true }]);
  });

  it("one question: the retry is the same question; two wrong answers block, a third is refused", async () => {
    await complete(oneQ, SEED.student.id);
    actAs(SEED.student.id);
    const first = await (await answer(oneQ, { selectedOption: 0 })).json();
    expect(first).toMatchObject({ correct: false, status: "retry", attemptsRemaining: 1 });
    expect(first.nextQuestion.es.prompt).toBe("Question 1 (es)");
    const second = await (await answer(oneQ, { selectedOption: 2 })).json();
    expect(second).toEqual({ correct: false, status: "blocked", attemptsRemaining: 0, nextQuestion: null });
    const third = await answer(oneQ, { selectedOption: 1 }); // 1 is the key, but no attempts remain
    expect(third.status).toBe(409);
    expect((await third.json()).error.code).toBe("no_attempts_left");
    expect(await getComprehensionForStudent(oneQ, SEED.student.id)).toMatchObject({ status: "blocked", attemptsRemaining: 0, question: null });
    const rows = await db.select().from(lectureComprehensionAttempts).where(and(eq(lectureComprehensionAttempts.lectureId, oneQ), eq(lectureComprehensionAttempts.studentId, SEED.student.id)));
    expect(rows).toHaveLength(2);
  });

  it("a position past the option count is a 400 and costs no attempt", async () => {
    const id = await ready(q(1, "0"));
    await complete(id, SEED.student.id);
    actAs(SEED.student.id);
    expect((await answer(id, { selectedOption: 5 })).status).toBe(400);
    expect(await getComprehensionForStudent(id, SEED.student.id)).toMatchObject({ attemptsUsed: 0 });
  });

  it("correctness never depends on the language: editing the wording keeps the key by position", async () => {
    const id = await ready(q(1, "1"));
    await complete(id, SEED.student.id);
    actAs(SEED.profA.id);
    await save(id, { ...q(1, "1"), q1OptionsEn: "Other 1\nOther 2\nOther 3" });
    actAs(SEED.student.id);
    expect(await (await answer(id, { selectedOption: 1 })).json()).toMatchObject({ correct: true });
  });

  it("racing submissions can never create a third attempt", async () => {
    const id = await ready(q(1, "0"));
    await complete(id, SEED.student.id);
    actAs(SEED.student.id);
    await Promise.all(Array.from({ length: 3 }, () => answer(id, { selectedOption: 1 })));
    const rows = await db.select().from(lectureComprehensionAttempts).where(and(eq(lectureComprehensionAttempts.lectureId, id), eq(lectureComprehensionAttempts.studentId, SEED.student.id)));
    expect(rows.length).toBeLessThanOrEqual(2);
    expect(new Set(rows.map((r) => r.attemptNumber)).size).toBe(rows.length);
  });

  it("attempts disappear with the lecture", async () => {
    const id = await ready(q(1, "0"));
    await complete(id, SEED.student.id);
    actAs(SEED.student.id);
    await answer(id, { selectedOption: 0 });
    expect(await db.select().from(lectureComprehensionAttempts).where(eq(lectureComprehensionAttempts.lectureId, id))).toHaveLength(1);
    await db.delete(lectures).where(eq(lectures.id, id));
    expect(await db.select().from(lectureComprehensionAttempts).where(eq(lectureComprehensionAttempts.lectureId, id))).toHaveLength(0);
  });

  it("is rate limited", async () => {
    // Exhaust a user's bucket directly (the same key the route uses); the next
    // call must be refused before any lookup. student2 isn't enrolled, so
    // nothing else could be touched.
    actAs(SEED.student2.id);
    // One write sets the counter at the allowance (a loop of checks over a slow
    // remote DB could outlast the 60 s window and reset it mid-way).
    const key = bucketKey("lecture_comprehension", "id", SEED.student2.id);
    const limit = RATE_LIMITS.lecture_comprehension.perIdentifier.limit;
    await db
      .insert(rateLimitBuckets)
      .values({ key, count: limit, windowStart: sql`now()` })
      .onConflictDoUpdate({ target: rateLimitBuckets.key, set: { count: limit, windowStart: sql`now()` } });
    const res = await answer(twoQ, { selectedOption: 0 });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("rate_limited");
  });
});
