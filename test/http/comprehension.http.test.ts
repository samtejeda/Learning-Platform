import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { lectureComprehensionAttempts, lectureProgress } from "@/lib/db/schema";
import { resetSeedData, SEED, seedUsers } from "@/test/seed";
import { insertCourse } from "@/lib/data/courses";
import { inviteByEmail } from "@/lib/data/enrollments";
import { insertLecture, markLectureUploaded, setLecturePublished } from "@/lib/data/lectures";
import { saveOwnedComprehension, setOwnedComprehensionEnabled } from "@/lib/data/lecture-comprehension";
import { client, signIn, type Http } from "./session";

// The comprehension route over real HTTP: real sessions, real proxy, real
// server. No video is needed (the question only needs a published lecture the
// student has completed), so completion is recorded directly. Wording is
// placeholders only.

const A = { id: SEED.profA.id, role: "professor" as const };
const slot = (n: number, key: number) => ({
  kind: "question" as const,
  columns: {
    promptEs: `Question ${n} (es)`,
    promptEn: `Question ${n} (en)`,
    optionsEs: ["Option A (es)", "Option B (es)", "Option C (es)"],
    optionsEn: ["Option A (en)", "Option B (en)", "Option C (en)"],
    correctOption: key,
  },
});
const BLANK = { kind: "blank" as const };

describe("comprehension question over HTTP", () => {
  let courseId: string;
  const ids = {
    enabled: "e0000000-0000-4000-8000-000000000001",
    twoQuestions: "e0000000-0000-4000-8000-000000000002",
    draft: "e0000000-0000-4000-8000-000000000003",
    disabled: "e0000000-0000-4000-8000-000000000004",
    notWatched: "e0000000-0000-4000-8000-000000000005",
  };
  let signedOut: Http, prof: Http, student: Http, outsider: Http;

  async function lecture(id: string, o: { publish: boolean; slots?: [typeof BLANK | ReturnType<typeof slot>, typeof BLANK | ReturnType<typeof slot>]; enable?: boolean; watched?: boolean }) {
    await insertLecture({ id, courseId, title: `Lecture ${id.slice(-1)}`, description: null, videoStoragePath: `courses/${courseId}/lectures/${id}/video.mp4` });
    await markLectureUploaded(id, 100);
    if (o.slots) expect((await saveOwnedComprehension(id, A, o.slots)).ok).toBe(true);
    if (o.enable) expect((await setOwnedComprehensionEnabled(id, A, true)).ok).toBe(true);
    if (o.publish) expect(await setLecturePublished(id, true)).toBe(true);
    if (o.watched !== false) {
      await db.insert(lectureProgress).values({ studentId: SEED.student.id, lectureId: id, completed: true, completedAt: new Date(), watchedSeconds: 100 });
    }
  }

  beforeAll(async () => {
    await seedUsers();
    await resetSeedData();
    ({ id: courseId } = await insertCourse({ title: "HTTP comprehension", description: null, professorId: SEED.profA.id }));
    await inviteByEmail(courseId, SEED.student.email, SEED.profA.id); // student2 is NOT enrolled

    await lecture(ids.enabled, { publish: true, slots: [slot(1, 1), BLANK], enable: true });
    await lecture(ids.twoQuestions, { publish: true, slots: [slot(1, 2), slot(2, 0)], enable: true });
    await lecture(ids.draft, { publish: false, slots: [slot(1, 1), BLANK], enable: true });
    await lecture(ids.disabled, { publish: true, slots: [slot(1, 1), BLANK] }); // written, never enabled
    await lecture(ids.notWatched, { publish: true, slots: [slot(1, 1), BLANK], enable: true, watched: false });

    const [pc, sc, oc] = await Promise.all([signIn(SEED.profA.email), signIn(SEED.student.email), signIn(SEED.student2.email)]);
    signedOut = client();
    prof = client(pc);
    student = client(sc);
    outsider = client(oc);
  });

  afterAll(async () => {
    await resetSeedData();
  });

  const url = (id: string) => `/api/lectures/${id}/comprehension`;

  it("signed-out callers get a JSON 401; cross-origin POSTs get 403", async () => {
    const res = await signedOut.post(url(ids.enabled), { selectedOption: 1 });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "unauthenticated", message: "Please sign in." } });
    expect((await student.post(url(ids.enabled), { selectedOption: 1 }, { origin: "https://evil.example" })).status).toBe(403);
  });

  it("a student who is not enrolled gets 404", async () => {
    const res = await outsider.post(url(ids.enabled), { selectedOption: 1 });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Not found." } });
  });

  it("an unpublished lecture gets 404, even for an enrolled student who completed it", async () => {
    expect((await student.post(url(ids.draft), { selectedOption: 1 })).status).toBe(404);
  });

  it("a disabled question gets 404, with the same body as every other no-access case", async () => {
    const res = await student.post(url(ids.disabled), { selectedOption: 1 });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Not found." } });
  });

  it("the owning professor, an unknown id and a malformed id are all 404", async () => {
    expect((await prof.post(url(ids.enabled), { selectedOption: 1 })).status).toBe(404);
    expect((await student.post(url("e0000000-0000-4000-8000-0000000000ff"), { selectedOption: 1 })).status).toBe(404);
    expect((await student.post(url("not-a-uuid"), { selectedOption: 1 })).status).toBe(404);
  });

  it("validates the body strictly", async () => {
    for (const bad of [{}, { selectedOption: "1" }, { selectedOption: -1 }, { selectedOption: 9 }, { selectedOption: 1, x: 1 }, { answer: "text" }]) {
      expect((await student.post(url(ids.enabled), bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await student.post(url(ids.enabled), { selectedOption: 5 })).status).toBe(400); // past the 3 options
  });

  it("cannot be answered before the lecture is completed", async () => {
    const res = await student.post(url(ids.notWatched), { selectedOption: 1 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("not_completed");
  });

  it("a wrong answer, then a right one on the retry (same question when only one was written)", async () => {
    const wrong = await student.post(url(ids.enabled), { selectedOption: 0 });
    expect(wrong.status).toBe(200);
    expect(wrong.headers.get("cache-control")).toBe("no-store");
    const w = await wrong.json();
    expect(w).toMatchObject({ correct: false, status: "retry", attemptsRemaining: 1 });
    expect(w.nextQuestion.es.prompt).toBe("Question 1 (es)");
    expect(JSON.stringify(w)).not.toMatch(/correct_?option/i);

    const right = await (await student.post(url(ids.enabled), { selectedOption: 1 })).json();
    expect(right).toEqual({ correct: true, status: "passed", attemptsRemaining: 0, nextQuestion: null });
    expect((await student.post(url(ids.enabled), { selectedOption: 1 })).status).toBe(409);
  });

  it("two questions: the second attempt asks the second question; two wrong answers block", async () => {
    const first = await (await student.post(url(ids.twoQuestions), { selectedOption: 0 })).json();
    expect(first).toMatchObject({ correct: false, status: "retry" });
    expect(first.nextQuestion.en.prompt).toBe("Question 2 (en)");
    const second = await (await student.post(url(ids.twoQuestions), { selectedOption: 1 })).json(); // question 2's key is 0
    expect(second).toEqual({ correct: false, status: "blocked", attemptsRemaining: 0, nextQuestion: null });
    const third = await student.post(url(ids.twoQuestions), { selectedOption: 0 });
    expect(third.status).toBe(409);
    expect((await third.json()).error.code).toBe("no_attempts_left");
  });

  it("stores no chosen option", async () => {
    const rows = await db.select().from(lectureComprehensionAttempts);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["attemptNumber", "correct", "createdAt", "id", "lectureId", "questionSlot", "studentId"]);
    }
  });
});
