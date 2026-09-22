import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { actAs } from "@/test/setup-integration";
import { resetSeedData, SEED, seedUsers } from "@/test/seed";
import { insertCourse, getCourseForStudent } from "@/lib/data/courses";
import { inviteByEmail } from "@/lib/data/enrollments";
import { insertLecture, markLectureUploaded, setLecturePublished } from "@/lib/data/lectures";
import { getLectureForViewer, recordProgress } from "@/lib/data/progress";
import { GET as streamGET } from "@/app/api/lectures/[lectureId]/stream/route";
import { POST as progressPOST } from "@/app/api/lectures/[lectureId]/progress/route";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...actual,
    createLectureStreamUrl: async (path: string) => ({
      url: `https://storage.test/sign/${path}?token=x`,
      expiresAt: new Date(Date.now() + 900_000),
    }),
  };
});

const ORIGIN = "http://localhost:3000";
const ctx = (lectureId: string) => ({ params: Promise.resolve({ lectureId }) });
const stream = (lectureId: string) => streamGET(new NextRequest(`${ORIGIN}/api/lectures/${lectureId}/stream`), ctx(lectureId));
const post = (lectureId: string, body: unknown, headers: Record<string, string> = {}) =>
  progressPOST(
    new NextRequest(`${ORIGIN}/api/lectures/${lectureId}/progress`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    ctx(lectureId),
  );

describe("stream + progress route handlers", () => {
  let courseId: string;
  const published = "b0000000-0000-4000-8000-000000000001";
  const draft = "b0000000-0000-4000-8000-000000000002";

  beforeAll(async () => {
    await seedUsers();
    await resetSeedData();
    ({ id: courseId } = await insertCourse({ title: "Progress test", description: null, professorId: SEED.profA.id }));
    await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);
    for (const [id, title] of [[published, "Published"], [draft, "Draft"]] as const) {
      await insertLecture({ id, courseId, title, description: null, videoStoragePath: `courses/${courseId}/lectures/${id}/video.mp4` });
      await markLectureUploaded(id, 100);
    }
    await setLecturePublished(published, true);
  });
  afterAll(async () => {
    await resetSeedData();
  });

  it("stream: 401 signed out, 404 unenrolled / draft / bad id, 200 enrolled, 200 owner preview of a draft", async () => {
    actAs(null);
    expect((await stream(published)).status).toBe(401);
    actAs(SEED.student2.id);
    expect((await stream(published)).status).toBe(404);
    actAs(SEED.student.id);
    expect((await stream(draft)).status).toBe(404);
    expect((await stream("not-a-uuid")).status).toBe(404);
    const ok = await stream(published);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = await ok.json();
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "url"]);
    expect(body.url).toContain(`lectures/${published}/video.mp4`);
    actAs(SEED.profA.id);
    expect((await stream(draft)).status).toBe(200);
    actAs(SEED.profB.id);
    expect((await stream(draft)).status).toBe(404);
  });

  it("progress: cross-origin, unauthenticated, unenrolled, unpublished, malformed", async () => {
    actAs(SEED.student.id);
    expect((await post(published, { from: 0, to: 5 }, { origin: "https://evil.example" })).status).toBe(403);
    actAs(null);
    expect((await post(published, { from: 0, to: 5 })).status).toBe(401);
    actAs(SEED.student2.id);
    expect((await post(published, { from: 0, to: 5 })).status).toBe(404);
    actAs(SEED.student.id);
    expect((await post(draft, { from: 0, to: 5 })).status).toBe(404);
    expect((await post(published, "{not json")).status).toBe(400);
    expect((await post(published, { from: "0", to: 5 })).status).toBe(400);
    expect((await post(published, { from: 0, to: 5, extra: 1 })).status).toBe(400);
    expect((await post(published, { from: 0, to: 600 })).status).toBe(400); // too long
    expect((await post(published, { from: 50, to: 40 })).status).toBe(400);
    // A professor previewing is not enrolled → nothing is recorded.
    actAs(SEED.profA.id);
    expect((await post(published, { from: 0, to: 5 })).status).toBe(404);
  });

  it("progress: accepts real playback, ignores fabricated bursts, completes at threshold", async () => {
    actAs(SEED.student.id);
    const first = await post(published, { from: 0, to: 10, position: 10 });
    expect(first.status).toBe(200);
    const b1 = await first.json();
    expect(b1).toMatchObject({ accepted: true, percent: 10, completed: false, watchedSeconds: 10, intervals: [[0, 10]] });

    // 20 s of new material claimed immediately → ignored, nothing credited.
    const burst = await post(published, { from: 10, to: 30 });
    expect(burst.status).toBe(200);
    expect(await burst.json()).toEqual({ accepted: false, reason: "too_fast" });
    const view = await getLectureForViewer(published, { id: SEED.student.id, role: "student" });
    expect(view!.progress).toMatchObject({ watchedSeconds: 10, percent: 10, lastPositionSeconds: 30 });

    // Simulate genuine playback by recording with explicit timestamps.
    const base = new Date(Date.now() + 60_000);
    let t = 10;
    for (let i = 0; t < 100; i++) {
      const r = await recordProgress(published, SEED.student.id, { from: t, to: t + 10 }, t + 10, new Date(base.getTime() + (i + 1) * 10_000));
      expect(r.ok, `segment ${t}`).toBe(true);
      t += 10;
    }
    const done = await getLectureForViewer(published, { id: SEED.student.id, role: "student" });
    expect(done!.progress).toMatchObject({ completed: true, percent: 100, intervals: [[0, 100]] });
    const course = await getCourseForStudent(courseId, SEED.student.id);
    expect(course!.lectures).toMatchObject([{ id: published, completed: true, percentWatched: 100 }]);
  });

  it("rate limit returns 429 after the per-user allowance", async () => {
    actAs(SEED.student2.id);
    // Exhaust student2's per-user bucket directly (same key both handlers
    // use); the next stream AND progress call must be refused before any
    // lookup. student2 isn't enrolled, so nothing else could be touched.
    const policy = RATE_LIMITS.lecture_progress.perIdentifier;
    for (let i = 0; i < policy.limit; i++) {
      await checkRateLimit({ scope: "lecture_progress", kind: "id", subject: SEED.student2.id, window: policy });
    }
    expect((await stream(published)).status).toBe(429);
    expect((await post(published, { from: 0, to: 5 })).status).toBe(429);
  }, 120_000);
});
