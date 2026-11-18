import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { actAs } from "@/test/setup-integration";
import { openView } from "@/test/lecture-views";
import { resetSeedData, SEED, seedUsers } from "@/test/seed";
import { db } from "@/lib/db";
import {
  lectureComprehensionAttempts,
  lectureComprehensionUnlocks,
  lectureProgress,
  lectures,
  rateLimitBuckets,
} from "@/lib/db/schema";
import { getCourseForStudent, insertCourse } from "@/lib/data/courses";
import { inviteByEmail, removeEnrollment } from "@/lib/data/enrollments";
import { insertLecture, insertYoutubeLecture, markLectureUploaded, setLecturePublished } from "@/lib/data/lectures";
import { getLectureForViewer, recordProgress } from "@/lib/data/progress";
import { getStudentLectureLocks } from "@/lib/data/lecture-locks";
import { listBlockedStudents } from "@/lib/data/lecture-unlocks";
import {
  getComprehensionForStudent,
  getOwnedComprehension,
  submitComprehensionAnswer,
} from "@/lib/data/lecture-comprehension";
import {
  disableLectureComprehension,
  enableLectureComprehension,
  publishLecture,
  reorderLectures,
  saveLectureComprehension,
  unlockStudentOnLecture,
  unpublishLecture,
} from "@/lib/lectures/actions";
import { GET as streamGET } from "@/app/api/lectures/[lectureId]/stream/route";
import { POST as progressPOST } from "@/app/api/lectures/[lectureId]/progress/route";
import { POST as comprehensionPOST } from "@/app/api/lectures/[lectureId]/comprehension/route";
import { AuthError } from "@/lib/auth/session";
import { bucketKey, RATE_LIMITS } from "@/lib/rate-limit/policy";

// The shared dev database is remote; each action is several round trips.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

// A locked lecture must never reach Storage or the CDN. Every call is recorded.
const calls = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...actual,
    createLectureStreamUrl: async (path: string) => {
      calls.list.push(`sign:${path}`);
      return { url: `https://storage.test/sign/${path}?token=x`, expiresAt: new Date(Date.now() + 900_000) };
    },
  };
});
vi.mock("@/lib/video-cdn/server", () => ({
  toCdnUrl: async (path: string, signed: { url: string }) => {
    calls.list.push(`cdn:${path}`);
    return signed.url;
  },
}));

const ORIGIN = "http://localhost:3000";
const YT = "dQw4w9WgXcQ";
const ctx = (lectureId: string) => ({ params: Promise.resolve({ lectureId }) });
const stream = (id: string) => streamGET(new NextRequest(`${ORIGIN}/api/lectures/${id}/stream`), ctx(id));
const ping = (id: string, body: unknown) =>
  progressPOST(
    new NextRequest(`${ORIGIN}/api/lectures/${id}/progress`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(body),
    }),
    ctx(id),
  );
const answerRoute = (id: string, selectedOption: number) =>
  comprehensionPOST(
    new NextRequest(`${ORIGIN}/api/lectures/${id}/comprehension`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ selectedOption }),
    }),
    ctx(id),
  );
const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
// Placeholder wording only; the professor's real wording is never authored here.
const question = {
  q1PromptEs: "Question (es)",
  q1PromptEn: "Question (en)",
  q1OptionsEs: "A (es)\nB (es)\nC (es)",
  q1OptionsEn: "A (en)\nB (en)\nC (en)",
  q1Correct: "1",
};

const STUDENT = { id: SEED.student.id, role: "student" as const };
const STUDENT2 = { id: SEED.student2.id, role: "student" as const };
const PROF_A = { id: SEED.profA.id, role: "professor" as const };

type Spec = { source?: "upload" | "youtube"; question?: boolean; publish?: boolean };
let order: string[] = [];
async function lecture(courseId: string, spec: Spec = {}): Promise<string> {
  const id = randomUUID();
  if (spec.source === "youtube") {
    await insertYoutubeLecture({ id, courseId, title: `L${order.length + 1}`, description: null, youtubeVideoId: YT, durationSeconds: 100 });
  } else {
    await insertLecture({ id, courseId, title: `L${order.length + 1}`, description: null, videoStoragePath: `courses/${courseId}/lectures/${id}/video.mp4` });
    await markLectureUploaded(id, 100);
  }
  order.push(id);
  if (spec.question) {
    actAs(SEED.profA.id);
    expect(await saveLectureComprehension(id, null, fd(question))).toEqual({ success: "Comprehension question saved." });
    expect(await enableLectureComprehension(id)).toEqual({ success: "Comprehension question turned on." });
  }
  if (spec.publish !== false) expect(await setLecturePublished(id, true)).toBe(true);
  return id;
}
async function complete(lectureId: string, studentId: string) {
  await db
    .insert(lectureProgress)
    .values({ studentId, lectureId, completed: true, completedAt: new Date(), watchedSeconds: 100 })
    .onConflictDoNothing();
}
/** An option position that is wrong / right for the lecture's question (read with the professor DTO). */
async function options(lectureId: string) {
  const q = (await getOwnedComprehension(lectureId, PROF_A))!.questions[0];
  return { right: q.correctOption!, wrong: (q.correctOption! + 1) % 3 };
}
async function failTwice(lectureId: string, studentId: string) {
  const { wrong } = await options(lectureId);
  expect((await submitComprehensionAnswer(lectureId, studentId, wrong)).ok).toBe(true);
  const second = await submitComprehensionAnswer(lectureId, studentId, wrong);
  expect(second).toMatchObject({ ok: true, correct: false, status: "blocked" });
}
const lockOf = async (courseId: string, studentId: string, lectureId: string) =>
  (await getStudentLectureLocks(db, courseId, studentId)).get(lectureId) ?? null;
const progressRows = async (studentId: string, ids: string[]) =>
  (await db.select().from(lectureProgress).where(eq(lectureProgress.studentId, studentId))).filter((r) => ids.includes(r.lectureId));
const attemptsOf = async (lectureId: string, studentId: string) =>
  db
    .select({ n: lectureComprehensionAttempts.attemptNumber, correct: lectureComprehensionAttempts.correct })
    .from(lectureComprehensionAttempts)
    .where(and(eq(lectureComprehensionAttempts.lectureId, lectureId), eq(lectureComprehensionAttempts.studentId, studentId)))
    .orderBy(lectureComprehensionAttempts.attemptNumber);

describe("comprehension locks", () => {
  beforeAll(async () => {
    await seedUsers();
    await resetSeedData();
  });
  afterAll(async () => {
    await resetSeedData();
  });
  beforeEach(() => {
    calls.list.length = 0;
    order = [];
  });

  describe("one course, five lectures (question on L1 and L4), every enforcement point", () => {
    let courseId: string;
    let L: string[];

    beforeAll(async () => {
      ({ id: courseId } = await insertCourse({ title: "Locks", description: null, professorId: SEED.profA.id }));
      await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);
      await inviteByEmail(courseId, SEED.student2.email, SEED.profA.id);
      order = [];
      L = [
        await lecture(courseId, { source: "upload", question: true }), // L1: question
        await lecture(courseId, { source: "youtube" }), // L2: youtube, plain
        await lecture(courseId, { source: "upload" }), // L3: plain
        await lecture(courseId, { source: "youtube", question: true }), // L4: question
        await lecture(courseId, { source: "upload" }), // L5
      ];
    });

    it("locks follow the rule before anything is watched (the first lecture is open, a chain locks the rest)", async () => {
      const list = (await getCourseForStudent(courseId, SEED.student.id))!.lectures;
      const lock = Object.fromEntries(list.map((l) => [l.id, l.lock]));
      expect(lock[L[0]]).toBeNull();
      expect(lock[L[1]]).toEqual({ reason: "previous_not_completed", afterLectureId: L[0], cause: "previous_not_completed" });
      expect(lock[L[2]]).toEqual({ reason: "previous_locked", afterLectureId: L[0], cause: "previous_not_completed" });
      expect(lock[L[3]]).toEqual({ reason: "previous_locked", afterLectureId: L[0], cause: "previous_not_completed" });
      expect(lock[L[4]]).toEqual({ reason: "previous_not_completed", afterLectureId: L[3], cause: "previous_not_completed" });
      // Reason code only: no question text or key anywhere in the list.
      expect(JSON.stringify(list)).not.toMatch(/Question \(|correct/i);
    });

    it("the list and the lecture view agree, for every lecture", async () => {
      const list = (await getCourseForStudent(courseId, SEED.student.id))!.lectures;
      for (const l of list) {
        const view = await getLectureForViewer(l.id, STUDENT);
        expect(view, l.id).not.toBeNull();
        expect(view!.locked, l.id).toBe(l.lock !== null);
        if (view!.locked) expect(view!.lock).toEqual(l.lock);
      }
    });

    it("a locked lecture has no video fields at all (upload and YouTube)", async () => {
      for (const id of [L[1], L[2], L[3]]) {
        const view = (await getLectureForViewer(id, STUDENT))!;
        expect(view.locked).toBe(true);
        expect(Object.keys(view).sort()).toEqual(["courseId", "id", "lock", "locked", "title"]);
      }
    });

    it("stream: 403 'locked' for an upload and a YouTube lecture, no Storage/CDN call, no URL or id in the body", async () => {
      actAs(SEED.student.id);
      for (const id of [L[1] /* youtube */, L[2] /* upload */]) {
        calls.list.length = 0;
        const res = await stream(id);
        expect(res.status, id).toBe(403);
        expect(res.headers.get("cache-control")).toBe("no-store");
        const text = JSON.stringify(await res.json());
        expect(JSON.parse(text).error.code).toBe("locked");
        expect(text).not.toMatch(/videoId|url|storage|youtube|dQw4/i);
        expect(calls.list).toEqual([]);
      }
      // 404 still wins for a lecture the student can't see at all.
      actAs(null);
      expect((await stream(L[1])).status).toBe(401);
    });

    it("progress: 403 'locked' and NOTHING is written, not even a progress row (that row would exempt the lecture)", async () => {
      actAs(SEED.student.id);
      for (const id of [L[1], L[2]]) {
        const res = await ping(id, { from: 0, to: 5, position: 5 });
        expect(res.status, id).toBe(403);
        expect((await res.json()).error.code).toBe("locked");
      }
      const direct = await recordProgress(L[1], SEED.student.id, { from: 0, to: 5 }, 5);
      expect(direct).toEqual({ ok: false, reason: "locked" });
      expect(await progressRows(SEED.student.id, [L[1], L[2]])).toEqual([]);
      // Still locked afterwards: the refused pings did not exempt it.
      expect(await lockOf(courseId, SEED.student.id, L[1])).not.toBeNull();
    });

    it("the comprehension route cannot be used to get around a lock (a lecture can't be completed while locked)", async () => {
      actAs(SEED.student.id);
      const res = await answerRoute(L[3], 0); // L4's question, L4 is locked, never completed
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("not_completed");
      expect(await attemptsOf(L[3], SEED.student.id)).toEqual([]);
    });

    it("instructor previews are never locked (owner, admin); another professor still gets 404", async () => {
      for (const who of [SEED.profA.id, SEED.admin.id]) {
        actAs(who);
        calls.list.length = 0;
        const yt = await stream(L[1]);
        expect(yt.status).toBe(200);
        expect(await yt.json()).toEqual({ source: "youtube", videoId: YT });
        expect((await stream(L[2])).status).toBe(200);
        const view = await getLectureForViewer(L[1], { id: who, role: who === SEED.admin.id ? "admin" : "professor" });
        expect(view!.locked).toBe(false);
      }
      actAs(SEED.profB.id);
      expect((await stream(L[1])).status).toBe(404);
    });

    it("completed but unanswered, then a wrong first attempt, is 'pending'", async () => {
      await complete(L[0], SEED.student.id);
      expect(await lockOf(courseId, SEED.student.id, L[1])).toEqual({
        reason: "previous_question_pending",
        afterLectureId: L[0],
        cause: "previous_question_pending",
      });
      const { wrong } = await options(L[0]);
      expect(await submitComprehensionAnswer(L[0], SEED.student.id, wrong)).toMatchObject({ ok: true, correct: false, status: "retry" });
      expect(await lockOf(courseId, SEED.student.id, L[1])).toMatchObject({ reason: "previous_question_pending" });
    });

    it("two wrong attempts: 'blocked', still locked on every route, and the comprehension state says so", async () => {
      // The previous test used attempt 1; this is the second wrong answer.
      const { wrong } = await options(L[0]);
      expect(await submitComprehensionAnswer(L[0], SEED.student.id, wrong)).toMatchObject({ ok: true, correct: false, status: "blocked" });
      expect(await lockOf(courseId, SEED.student.id, L[1])).toMatchObject({ reason: "previous_question_blocked", afterLectureId: L[0] });
      expect(await lockOf(courseId, SEED.student.id, L[2])).toMatchObject({ reason: "previous_locked", cause: "previous_question_blocked" });
      actAs(SEED.student.id);
      expect((await stream(L[1])).status).toBe(403);
      expect((await ping(L[2], { from: 0, to: 5 })).status).toBe(403);
      expect(await getComprehensionForStudent(L[0], SEED.student.id)).toMatchObject({
        status: "blocked",
        attemptsRemaining: 0,
        unlocked: false,
        question: null,
      });
    });

    it("the professor's blocked list shows exactly the roster fields plus lecture and time", async () => {
      const list = await listBlockedStudents(courseId, PROF_A);
      expect(list).toHaveLength(1);
      expect(Object.keys(list[0]).sort()).toEqual(["blockedAt", "email", "lectureId", "lectureTitle", "name", "studentId"]);
      expect(list[0]).toMatchObject({ lectureId: L[0], studentId: SEED.student.id, email: SEED.student.email, lectureTitle: "L1" });
      expect(list[0].blockedAt).toBeInstanceOf(Date);
      // Admin sees any course; another professor sees nothing.
      expect(await listBlockedStudents(courseId, { id: SEED.admin.id, role: "admin" })).toHaveLength(1);
      expect(await listBlockedStudents(courseId, { id: SEED.profB.id, role: "professor" })).toEqual([]);
    });

    describe("unlock action", () => {
      it("is refused for students and signed-out callers, bad ids, other professors, and students not enrolled", async () => {
        actAs(SEED.student.id);
        await expect(unlockStudentOnLecture(L[0], SEED.student.id)).rejects.toBeInstanceOf(AuthError);
        actAs(null);
        await expect(unlockStudentOnLecture(L[0], SEED.student.id)).rejects.toBeInstanceOf(AuthError);

        actAs(SEED.profA.id);
        const generic = { error: "Lecture or student not found." };
        expect(await unlockStudentOnLecture("nope", SEED.student.id)).toEqual(generic);
        expect(await unlockStudentOnLecture(L[0], "nope")).toEqual(generic);
        expect(await unlockStudentOnLecture(randomUUID(), SEED.student.id)).toEqual(generic);
        expect(await unlockStudentOnLecture(L[0], randomUUID())).toEqual(generic); // not a user at all

        actAs(SEED.profB.id);
        expect(await unlockStudentOnLecture(L[0], SEED.student.id)).toEqual(generic); // cross-professor

        // A real account that is not enrolled in this course.
        actAs(SEED.profA.id);
        await removeEnrollment(courseId, SEED.student2.id);
        expect(await unlockStudentOnLecture(L[0], SEED.student2.id)).toEqual(generic);
        await inviteByEmail(courseId, SEED.student2.email, SEED.profA.id);

        expect(await db.select().from(lectureComprehensionUnlocks).where(eq(lectureComprehensionUnlocks.lectureId, L[0]))).toEqual([]);
      });

      it("unlocks once, is idempotent, records who, and never alters the attempts", async () => {
        const before = await attemptsOf(L[0], SEED.student.id);
        expect(before).toHaveLength(2);
        actAs(SEED.profA.id);
        expect(await unlockStudentOnLecture(L[0], SEED.student.id)).toEqual({ success: "Unlocked." });
        expect(await unlockStudentOnLecture(L[0], SEED.student.id)).toEqual({ success: "Already unlocked." });
        const rows = await db.select().from(lectureComprehensionUnlocks).where(eq(lectureComprehensionUnlocks.lectureId, L[0]));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ studentId: SEED.student.id, unlockedBy: SEED.profA.id });
        expect(await attemptsOf(L[0], SEED.student.id)).toEqual(before);
      });

      it("the unlock opens exactly what it should, on every route, for upload and YouTube", async () => {
        expect(await lockOf(courseId, SEED.student.id, L[1])).toBeNull();
        expect(await lockOf(courseId, SEED.student.id, L[2])).toBeNull();
        expect(await lockOf(courseId, SEED.student.id, L[3])).toBeNull(); // L3 has no question
        // L5 follows L4 (question, not completed): still locked.
        expect(await lockOf(courseId, SEED.student.id, L[4])).toMatchObject({ reason: "previous_not_completed", afterLectureId: L[3] });

        actAs(SEED.student.id);
        calls.list.length = 0;
        const yt = await stream(L[1]);
        expect(yt.status).toBe(200);
        expect(await yt.json()).toEqual({ source: "youtube", videoId: YT });
        const up = await stream(L[2]);
        expect(up.status).toBe(200);
        expect(Object.keys(await up.json()).sort()).toEqual(["expiresAt", "source", "url"]);
        expect((await ping(L[1], { from: 0, to: 5, position: 5 })).status).toBe(200);
        expect((await stream(L[4])).status).toBe(403);
      });

      it("the comprehension state shows 'blocked' history plus unlocked, and the blocked list empties", async () => {
        expect(await getComprehensionForStudent(L[0], SEED.student.id)).toMatchObject({
          status: "blocked",
          attemptsUsed: 2,
          unlocked: true,
          question: null,
        });
        expect(await listBlockedStudents(courseId, PROF_A)).toEqual([]);
      });

      it("is rate limited per professor", async () => {
        const key = bucketKey("lecture_unlock", "id", SEED.profA.id);
        const limit = RATE_LIMITS.lecture_unlock.perIdentifier.limit;
        await db
          .insert(rateLimitBuckets)
          .values({ key, count: limit, windowStart: sql`now()` })
          .onConflictDoUpdate({ target: rateLimitBuckets.key, set: { count: limit, windowStart: sql`now()` } });
        actAs(SEED.profA.id);
        const res = await unlockStudentOnLecture(L[0], SEED.student2.id);
        expect(res?.error).toBeTruthy();
        expect(res?.error).not.toBe("Lecture or student not found.");
        await db.delete(rateLimitBuckets).where(eq(rateLimitBuckets.key, key));
      });
    });

    describe("changes are re-evaluated live (student 2 has done nothing)", () => {
      it("turning the question off opens the next lecture, on locks it again; attempts are kept", async () => {
        expect(await lockOf(courseId, SEED.student2.id, L[1])).not.toBeNull();
        actAs(SEED.profA.id);
        expect(await disableLectureComprehension(L[0])).toEqual({ success: "Comprehension question turned off." });
        expect(await lockOf(courseId, SEED.student2.id, L[1])).toBeNull();
        expect(await lockOf(courseId, SEED.student2.id, L[2])).toBeNull();
        actAs(SEED.student2.id);
        expect((await stream(L[1])).status).toBe(200);
        actAs(SEED.profA.id);
        expect(await enableLectureComprehension(L[0])).toEqual({ success: "Comprehension question turned on." });
        expect(await lockOf(courseId, SEED.student2.id, L[1])).not.toBeNull();
        // The unlock and the attempts of student 1 survived the toggle.
        expect(await lockOf(courseId, SEED.student.id, L[1])).toBeNull();
        expect(await attemptsOf(L[0], SEED.student.id)).toHaveLength(2);
      });

      it("reordering moves the lock", async () => {
        actAs(SEED.profA.id);
        expect(await reorderLectures(courseId, { orderedIds: [L[2], L[0], L[1], L[3], L[4]] })).toEqual({ success: "Order saved." });
        expect(await lockOf(courseId, SEED.student2.id, L[2])).toBeNull(); // now first
        expect(await lockOf(courseId, SEED.student2.id, L[0])).toBeNull(); // follows a lecture with no question
        expect(await lockOf(courseId, SEED.student2.id, L[1])).toMatchObject({ reason: "previous_not_completed", afterLectureId: L[0] });
        expect(await reorderLectures(courseId, { orderedIds: L })).toEqual({ success: "Order saved." });
        expect(await lockOf(courseId, SEED.student2.id, L[1])).not.toBeNull();
      });

      it("unpublishing the lecture with the question makes the next lecture judged on the previous published one", async () => {
        actAs(SEED.profA.id);
        expect(await unpublishLecture(L[0])).toEqual({ success: "Unpublished." });
        expect(await lockOf(courseId, SEED.student2.id, L[1])).toBeNull(); // now the first published lecture
        expect(await lockOf(courseId, SEED.student2.id, L[0])).toBeNull(); // not in the published list at all
        actAs(SEED.student2.id);
        expect((await stream(L[0])).status).toBe(404); // unpublished is still a 404, not a lock
        actAs(SEED.profA.id);
        expect(await publishLecture(L[0])).toEqual({ success: "Published." });
        expect(await lockOf(courseId, SEED.student2.id, L[1])).not.toBeNull();
      });

      it("the mid-course exemption: a lecture already started stays open even though the question is uncleared", async () => {
        expect(await lockOf(courseId, SEED.student2.id, L[1])).not.toBeNull();
        await db.insert(lectureProgress).values({ studentId: SEED.student2.id, lectureId: L[1], watchedSeconds: 5 });
        expect(await lockOf(courseId, SEED.student2.id, L[1])).toBeNull();
        actAs(SEED.student2.id);
        expect((await stream(L[1])).status).toBe(200);
        expect((await ping(L[1], { from: 5, to: 10, position: 10 })).status).toBe(200);
        // The lecture after it is judged on L2 (no question), so it is open too.
        expect(await lockOf(courseId, SEED.student2.id, L[2])).toBeNull();
        // L5 is unaffected by the exemption.
        expect(await lockOf(courseId, SEED.student2.id, L[4])).toMatchObject({ afterLectureId: L[3] });
      });

      it("an exempt lecture does not unlock a lecture that has its own uncleared predecessor question", async () => {
        // L4 follows L3 (no question) so it's open; L5 follows L4 (question uncleared).
        actAs(SEED.student2.id);
        expect((await ping(L[4], { from: 0, to: 5 })).status).toBe(403);
        expect(await progressRows(SEED.student2.id, [L[4]])).toEqual([]);
      });
    });
  });

  describe("passing", () => {
    it("passing on attempt 1 opens the next lecture and a pass stays a pass when the question is edited", async () => {
      const { id: courseId } = await insertCourse({ title: "Pass", description: null, professorId: SEED.profA.id });
      await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);
      order = [];
      const first = await lecture(courseId, { question: true });
      const next = await lecture(courseId, {});
      await complete(first, SEED.student.id);
      expect(await lockOf(courseId, SEED.student.id, next)).not.toBeNull();
      const { right } = await options(first);
      expect(await submitComprehensionAnswer(first, SEED.student.id, right)).toMatchObject({ ok: true, correct: true, status: "passed" });
      expect(await lockOf(courseId, SEED.student.id, next)).toBeNull();

      // The professor changes the key afterwards: the stored pass is untouched.
      actAs(SEED.profA.id);
      expect(await saveLectureComprehension(first, null, fd({ ...question, q1Correct: "2" }))).toEqual({ success: "Comprehension question saved." });
      expect(await lockOf(courseId, SEED.student.id, next)).toBeNull();
      actAs(SEED.student.id);
      expect((await stream(next)).status).toBe(200);
    });

    it("passing on attempt 2 also clears it", async () => {
      const { id: courseId } = await insertCourse({ title: "Pass 2", description: null, professorId: SEED.profA.id });
      await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);
      order = [];
      const first = await lecture(courseId, { question: true });
      const next = await lecture(courseId, {});
      await complete(first, SEED.student.id);
      const { right, wrong } = await options(first);
      await submitComprehensionAnswer(first, SEED.student.id, wrong);
      expect(await lockOf(courseId, SEED.student.id, next)).toMatchObject({ reason: "previous_question_pending" });
      await submitComprehensionAnswer(first, SEED.student.id, right);
      expect(await lockOf(courseId, SEED.student.id, next)).toBeNull();
    });
  });

  describe("blocked list rules", () => {
    it("lists only published lectures with the question on, not unlocked, enrolled; unlock/disable/unenroll remove the entry", async () => {
      const { id: courseId } = await insertCourse({ title: "Blocked", description: null, professorId: SEED.profA.id });
      await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);
      order = [];
      const published = await lecture(courseId, { question: true });
      const draft = await lecture(courseId, { question: true, publish: false });
      await complete(published, SEED.student.id);
      await failTwice(published, SEED.student.id);
      // Attempts on an unpublished lecture (written directly: the route would refuse them).
      await db.insert(lectureComprehensionAttempts).values([
        { studentId: SEED.student.id, lectureId: draft, attemptNumber: 1, questionSlot: 1, correct: false },
        { studentId: SEED.student.id, lectureId: draft, attemptNumber: 2, questionSlot: 1, correct: false },
      ]);
      expect((await listBlockedStudents(courseId, PROF_A)).map((b) => b.lectureId)).toEqual([published]);

      actAs(SEED.profA.id);
      expect(await disableLectureComprehension(published)).toMatchObject({ success: expect.any(String) });
      expect(await listBlockedStudents(courseId, PROF_A)).toEqual([]);
      expect(await enableLectureComprehension(published)).toMatchObject({ success: expect.any(String) });
      expect(await listBlockedStudents(courseId, PROF_A)).toHaveLength(1);

      await removeEnrollment(courseId, SEED.student.id);
      expect(await listBlockedStudents(courseId, PROF_A)).toEqual([]);
      await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);
      expect(await listBlockedStudents(courseId, PROF_A)).toHaveLength(1);

      expect(await unlockStudentOnLecture(published, SEED.student.id)).toEqual({ success: "Unlocked." });
      expect(await listBlockedStudents(courseId, PROF_A)).toEqual([]);
    });

    it("a student who has not used both attempts, or who passed, is not listed", async () => {
      const { id: courseId } = await insertCourse({ title: "Not blocked", description: null, professorId: SEED.profA.id });
      await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);
      await inviteByEmail(courseId, SEED.student2.email, SEED.profA.id);
      order = [];
      const q = await lecture(courseId, { question: true });
      await complete(q, SEED.student.id);
      await complete(q, SEED.student2.id);
      const { wrong, right } = await options(q);
      await submitComprehensionAnswer(q, SEED.student.id, wrong); // one wrong: retry
      await submitComprehensionAnswer(q, SEED.student2.id, wrong);
      await submitComprehensionAnswer(q, SEED.student2.id, right); // wrong then right: passed
      expect(await listBlockedStudents(courseId, PROF_A)).toEqual([]);
    });
  });
});
