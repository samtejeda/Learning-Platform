import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { actAs, RedirectSignal } from "@/test/setup-integration";
import { resetSeedData, SEED, seedUsers } from "@/test/seed";
import { db } from "@/lib/db";
import { lectures } from "@/lib/db/schema";
import { insertCourse } from "@/lib/data/courses";
import { inviteByEmail } from "@/lib/data/enrollments";
import {
  getOwnedLecture,
  insertLecture,
  insertYoutubeLecture,
  listLecturesForProfessor,
  listStoragePaths,
  markLectureUploaded,
  setLecturePublished,
} from "@/lib/data/lectures";
import { getLectureForViewer, recordProgress } from "@/lib/data/progress";
import { openView } from "@/test/lecture-views";
import {
  createYoutubeLecture,
  deleteLecture,
  finalizeLectureUpload,
  publishLecture,
  retryLectureUpload,
  saveLectureComprehension,
  unpublishLecture,
  updateLecture,
} from "@/lib/lectures/actions";
import { GET as streamGET } from "@/app/api/lectures/[lectureId]/stream/route";
import { POST as progressPOST } from "@/app/api/lectures/[lectureId]/progress/route";
import { AuthError } from "@/lib/auth/session";

// The shared dev database is remote; each action is several round trips.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

// Any Storage or CDN call made for a YouTube lecture is a bug, so every one
// of them throws. Upload-lecture behaviour is checked with the signing stub.
const storage = vi.hoisted(() => ({
  calls: [] as string[],
}));
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  const trap = (name: string) => async () => {
    storage.calls.push(name);
    throw new Error(`Storage must not be called: ${name}`);
  };
  return {
    ...actual,
    createLectureUploadUrl: trap("createLectureUploadUrl"),
    getObjectInfo: trap("getObjectInfo"),
    readLectureHead: trap("readLectureHead"),
    removeObjects: async (paths: string[]) => {
      storage.calls.push(`removeObjects:${paths.join(",")}`);
    },
    createLectureStreamUrl: async (path: string) => {
      storage.calls.push(`createLectureStreamUrl:${path}`);
      return { url: `https://storage.test/sign/${path}?token=x`, expiresAt: new Date(Date.now() + 900_000) };
    },
  };
});
vi.mock("@/lib/video-cdn/server", () => ({
  toCdnUrl: async (path: string, signed: { url: string }) => {
    storage.calls.push(`toCdnUrl:${path}`);
    return signed.url;
  },
}));

const ORIGIN = "http://localhost:3000";
const ID = "dQw4w9WgXcQ";
const ID2 = "9bZkp7q19f0";
const LINK = `https://www.youtube.com/watch?v=${ID}&t=30s`;
const ctx = (lectureId: string) => ({ params: Promise.resolve({ lectureId }) });
const stream = (lectureId: string) => streamGET(new NextRequest(`${ORIGIN}/api/lectures/${lectureId}/stream`), ctx(lectureId));
const post = (lectureId: string, body: unknown) =>
  progressPOST(
    new NextRequest(`${ORIGIN}/api/lectures/${lectureId}/progress`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(body),
    }),
    ctx(lectureId),
  );
const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const edit = (lectureId: string, fields: Record<string, string>) => updateLecture(lectureId, null, fd(fields));
const STUDENT = { id: SEED.student.id, role: "student" as const };

let courseId: string;
let n = 0;

async function ytLecture(opts: { publish?: boolean; duration?: number } = {}) {
  actAs(SEED.profA.id);
  const before = (await listLecturesForProfessor(courseId)).map((l) => l.id);
  const res = await createYoutubeLecture(courseId, {
    title: `YouTube ${++n}`,
    description: null,
    youtubeUrl: LINK,
    durationSeconds: opts.duration ?? 100,
  });
  expect(res.ok, JSON.stringify(res)).toBe(true);
  const id = (await listLecturesForProfessor(courseId)).map((l) => l.id).find((x) => !before.includes(x))!;
  if (opts.publish) expect(await setLecturePublished(id, true)).toBe(true);
  return id;
}
async function uploadLecture(opts: { publish?: boolean } = {}) {
  const id = randomUUID();
  await insertLecture({ id, courseId, title: `Upload ${++n}`, description: null, videoStoragePath: `courses/${courseId}/lectures/${id}/video.mp4` });
  await markLectureUploaded(id, 100);
  if (opts.publish) await setLecturePublished(id, true);
  return id;
}
const row = async (id: string) => (await db.select().from(lectures).where(eq(lectures.id, id)))[0];

describe("YouTube lectures", () => {
  beforeAll(async () => {
    await seedUsers();
    await resetSeedData();
    ({ id: courseId } = await insertCourse({ title: "YouTube test", description: null, professorId: SEED.profA.id }));
    await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);
  });
  afterAll(async () => {
    await resetSeedData();
  });
  beforeEach(() => {
    storage.calls.length = 0;
  });

  describe("lectures_video_source_check", () => {
    const base = () => ({ courseId, title: "raw" });
    const reject = async (values: Record<string, unknown>, why: string) => {
      const title = `raw-${why}`;
      await expect(db.insert(lectures).values({ ...base(), title, ...values } as never), why).rejects.toThrow();
      expect(await db.select().from(lectures).where(eq(lectures.title, title)), why).toHaveLength(0);
    };

    it("accepts exactly the two valid shapes, and an old-style insert defaults to upload", async () => {
      // The previous deploy's insert names neither new column.
      const [legacy] = await db
        .insert(lectures)
        .values({ ...base(), title: "legacy", videoStoragePath: "courses/x/lectures/y/video.mp4" })
        .returning();
      expect(legacy).toMatchObject({ videoSource: "upload", youtubeVideoId: null });

      const [yt] = await db
        .insert(lectures)
        .values({ ...base(), title: "yt-ok", videoSource: "youtube", youtubeVideoId: ID, durationSeconds: 60, videoUploadedAt: new Date() })
        .returning();
      expect(yt).toMatchObject({ videoSource: "youtube", youtubeVideoId: ID, videoStoragePath: null });
    });

    it("refuses an upload row with a YouTube id or no path", async () => {
      await reject({ videoStoragePath: "p", youtubeVideoId: ID }, "upload-with-id");
      await reject({ videoStoragePath: null }, "upload-no-path");
    });

    it("refuses a YouTube row with a bad id, a path, or no trusted duration", async () => {
      const ok = { videoSource: "youtube", youtubeVideoId: ID, durationSeconds: 60, videoUploadedAt: new Date() };
      await reject({ ...ok, youtubeVideoId: null }, "yt-null-id");
      await reject({ ...ok, youtubeVideoId: ID.slice(0, 10) }, "yt-short-id");
      await reject({ ...ok, youtubeVideoId: `${ID}x` }, "yt-long-id");
      await reject({ ...ok, youtubeVideoId: "dQw4w9WgXc!" }, "yt-bad-char");
      await reject({ ...ok, youtubeVideoId: "https://youtu.be/x" }, "yt-url");
      await reject({ ...ok, videoStoragePath: "courses/x/video.mp4" }, "yt-with-path");
      await reject({ ...ok, durationSeconds: null }, "yt-null-duration");
      await reject({ ...ok, durationSeconds: 0 }, "yt-zero-duration");
      await reject({ ...ok, videoUploadedAt: null }, "yt-not-ready");
    });
  });

  describe("createYoutubeLecture", () => {
    it("creates a draft that stores only the id, with the professor's duration", async () => {
      const id = await ytLecture({ duration: 754.4 });
      const r = await row(id);
      expect(r).toMatchObject({
        courseId,
        videoSource: "youtube",
        youtubeVideoId: ID, // the id, never the pasted URL
        videoStoragePath: null,
        durationSeconds: 754.4,
        publishedAt: null,
      });
      expect(r.videoUploadedAt).toBeInstanceOf(Date);
      expect(JSON.stringify(r)).not.toContain("youtube.com");
      const listed = (await listLecturesForProfessor(courseId)).find((l) => l.id === id);
      expect(listed).toMatchObject({ status: "draft", videoSource: "youtube", youtubeVideoId: ID });
      expect(storage.calls).toEqual([]);
    });

    it("rejects hostile or malformed links without writing a row", async () => {
      actAs(SEED.profA.id);
      const count = async () => (await listLecturesForProfessor(courseId)).length;
      const before = await count();
      for (const youtubeUrl of [
        "javascript:alert(1)",
        "http://youtu.be/dQw4w9WgXcQ",
        "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/playlist?list=PLabcdefghijklmnop",
        "https://169.254.169.254/latest/meta-data",
        ID,
        "",
      ]) {
        const res = await createYoutubeLecture(courseId, { title: "T", description: null, youtubeUrl, durationSeconds: 60 });
        expect(res.ok, youtubeUrl).toBe(false);
      }
      expect(await count()).toBe(before);
    });

    it("validates the duration range and the title", async () => {
      actAs(SEED.profA.id);
      for (const durationSeconds of [0, 0.5, -5, 86401, Number.NaN, "abc", null, undefined, true]) {
        const res = await createYoutubeLecture(courseId, { title: "T", description: null, youtubeUrl: LINK, durationSeconds });
        expect(res.ok, String(durationSeconds)).toBe(false);
      }
      expect((await createYoutubeLecture(courseId, { title: "", description: null, youtubeUrl: LINK, durationSeconds: 60 })).ok).toBe(false);
      // A numeric string (a form field) is fine; the range is the same.
      expect((await createYoutubeLecture(courseId, { title: "From a form", description: null, youtubeUrl: LINK, durationSeconds: "90" })).ok).toBe(true);
      expect((await createYoutubeLecture(courseId, { title: "T", description: null, youtubeUrl: LINK, durationSeconds: 86400 })).ok).toBe(true);
    });

    it("enforces roles and course ownership", async () => {
      const input = { title: "Not mine", description: null, youtubeUrl: LINK, durationSeconds: 60 };
      actAs(SEED.student.id);
      await expect(createYoutubeLecture(courseId, input)).rejects.toBeInstanceOf(AuthError);
      actAs(null);
      await expect(createYoutubeLecture(courseId, input)).rejects.toBeInstanceOf(AuthError);
      actAs(SEED.profB.id);
      expect(await createYoutubeLecture(courseId, input)).toEqual({ ok: false, error: "Course not found." });
      expect(await createYoutubeLecture("not-a-uuid", input)).toEqual({ ok: false, error: "Course not found." });
      expect((await db.select().from(lectures).where(eq(lectures.title, "Not mine")))).toHaveLength(0);
      actAs(SEED.admin.id);
      expect((await createYoutubeLecture(courseId, { ...input, title: "Admin made" })).ok).toBe(true);
    });
  });

  describe("updateLecture", () => {
    it("changes link and duration on a YouTube lecture; the source never changes", async () => {
      const id = await ytLecture();
      actAs(SEED.profA.id);
      await expect(
        edit(id, { title: "Renamed", description: "d", youtubeUrl: `https://youtu.be/${ID2}?si=x`, durationSeconds: "321" }),
      ).rejects.toBeInstanceOf(RedirectSignal);
      expect(await row(id)).toMatchObject({
        title: "Renamed",
        videoSource: "youtube",
        youtubeVideoId: ID2,
        durationSeconds: 321,
        videoStoragePath: null,
      });

      // Blank video fields leave them unchanged.
      await expect(edit(id, { title: "Renamed again", description: "", youtubeUrl: "", durationSeconds: "" })).rejects.toBeInstanceOf(RedirectSignal);
      expect(await row(id)).toMatchObject({ title: "Renamed again", youtubeVideoId: ID2, durationSeconds: 321 });

      // Hostile link / bad duration: refused, nothing written.
      const bad: Record<string, string>[] = [
        { youtubeUrl: "http://youtu.be/dQw4w9WgXcQ" },
        { youtubeUrl: "https://evil.com/watch?v=dQw4w9WgXcQ" },
        { durationSeconds: "0" },
        { durationSeconds: "999999" },
        { durationSeconds: "abc" },
      ];
      for (const fields of bad) {
        const res = await edit(id, { title: "Hacked", description: "", ...fields });
        expect(res?.error, JSON.stringify(fields)).toBeTruthy();
      }
      expect(await row(id)).toMatchObject({ title: "Renamed again", youtubeVideoId: ID2, durationSeconds: 321 });
    });

    it("refuses link/duration edits on an uploaded lecture (title still editable)", async () => {
      const id = await uploadLecture();
      actAs(SEED.profA.id);
      const res = await edit(id, { title: "Hijack", description: "", youtubeUrl: LINK, durationSeconds: "60" });
      expect(res?.error).toMatch(/only be changed on a YouTube lecture/);
      expect(await row(id)).toMatchObject({ videoSource: "upload", youtubeVideoId: null, durationSeconds: 100 });
      await expect(edit(id, { title: "Just a title", description: "" })).rejects.toBeInstanceOf(RedirectSignal);
      expect(await row(id)).toMatchObject({ title: "Just a title", videoSource: "upload", youtubeVideoId: null });
    });

    it("the data layer itself refuses video changes on an uploaded lecture", async () => {
      const id = await uploadLecture();
      const { updateLectureRow } = await import("@/lib/data/lectures");
      expect(await updateLectureRow(id, { title: "x", description: null, youtube: { videoId: ID } })).toBe(false);
      expect(await row(id)).toMatchObject({ youtubeVideoId: null, videoSource: "upload" });
    });

    it("a lecture in someone else's course can't be edited", async () => {
      const id = await ytLecture();
      actAs(SEED.profB.id);
      expect(await edit(id, { title: "Stolen", description: "", youtubeUrl: `https://youtu.be/${ID2}` })).toEqual({ error: "Lecture not found." });
      expect(await row(id)).toMatchObject({ youtubeVideoId: ID });
      expect(await getOwnedLecture(id, { id: SEED.profB.id, role: "professor" })).toBeNull();
      actAs(SEED.student.id);
      await expect(edit(id, { title: "x", description: "" })).rejects.toBeInstanceOf(AuthError);
    });

    it("changing the duration re-scores existing progress percentages (completions stay)", async () => {
      const id = await ytLecture({ publish: true, duration: 100 });
      await recordProgress(id, SEED.student.id, { from: 0, to: 10 }, 10, new Date());
      expect((openView(await getLectureForViewer(id, STUDENT))).progress).toMatchObject({ percent: 10, watchedSeconds: 10 });
      actAs(SEED.profA.id);
      await expect(edit(id, { title: "Longer", description: "", durationSeconds: "200" })).rejects.toBeInstanceOf(RedirectSignal);
      expect((openView(await getLectureForViewer(id, STUDENT))).progress).toMatchObject({ percent: 5, watchedSeconds: 10 });
    });
  });

  describe("publish rule", () => {
    it("a YouTube lecture publishes and unpublishes; an unfinished upload still can't", async () => {
      const id = await ytLecture();
      actAs(SEED.profA.id);
      expect(await publishLecture(id)).toEqual({ success: "Published." });
      expect((await row(id)).publishedAt).toBeInstanceOf(Date);
      expect(await unpublishLecture(id)).toEqual({ success: "Unpublished." });
      expect((await row(id)).publishedAt).toBeNull();

      const pending = randomUUID();
      await insertLecture({ id: pending, courseId, title: "Pending", description: null, videoStoragePath: `courses/${courseId}/lectures/${pending}/video.mp4` });
      expect(await setLecturePublished(pending, true)).toBe(false);
      expect(await publishLecture(pending)).toMatchObject({ error: expect.any(String) });
    });

    it("an enabled-but-incomplete comprehension question still blocks a YouTube lecture", async () => {
      const id = await ytLecture();
      // Constructed directly: the actions would refuse to enable an incomplete question.
      await db.update(lectures).set({ comprehensionEnabled: true }).where(eq(lectures.id, id));
      actAs(SEED.profA.id);
      expect(await publishLecture(id)).toMatchObject({ error: expect.stringContaining("comprehension") });
      expect(await setLecturePublished(id, true)).toBe(false);
      expect((await row(id)).publishedAt).toBeNull();

      // Complete in both languages (placeholder wording only) → publishes.
      expect(
        await saveLectureComprehension(id, null, fd({
          q1PromptEs: "Question 1 (es)", q1PromptEn: "Question 1 (en)",
          q1OptionsEs: "A (es)\nB (es)\nC (es)", q1OptionsEn: "A (en)\nB (en)\nC (en)", q1Correct: "1",
        })),
      ).toEqual({ success: "Comprehension question saved." });
      expect(await publishLecture(id)).toEqual({ success: "Published." });
    });
  });

  describe("storage is never touched for YouTube lectures", () => {
    it("deleteLecture removes the row without calling Storage; an upload still removes its object", async () => {
      const id = await ytLecture();
      actAs(SEED.profB.id);
      expect(await deleteLecture(id)).toEqual({ error: "Lecture not found." });
      expect(await row(id)).toBeDefined();
      actAs(SEED.profA.id);
      expect(await deleteLecture(id)).toEqual({ success: "Lecture deleted." });
      expect(await row(id)).toBeUndefined();
      expect(storage.calls).toEqual([]);

      const up = await uploadLecture();
      const path = (await row(up)).videoStoragePath!;
      expect(await deleteLecture(up)).toEqual({ success: "Lecture deleted." });
      expect(storage.calls).toEqual([`removeObjects:${path}`]);
    });

    it("retry and finalize refuse a YouTube lecture and make no Storage call", async () => {
      const id = await ytLecture();
      actAs(SEED.profA.id);
      expect(await retryLectureUpload(id)).toMatchObject({ ok: false, error: expect.stringContaining("YouTube") });
      expect(await finalizeLectureUpload(id, { durationSeconds: 5 })).toEqual({ error: expect.stringContaining("YouTube") });
      expect((await row(id)).durationSeconds).toBe(100); // finalize did not overwrite the duration
      expect(storage.calls).toEqual([]);
    });

    it("listStoragePaths skips YouTube lectures", async () => {
      const yt = await ytLecture();
      const up = await uploadLecture();
      expect(await listStoragePaths([yt, up])).toEqual([(await row(up)).videoStoragePath]);
      expect(await listStoragePaths([yt])).toEqual([]);
    });

    it("insertYoutubeLecture orders after existing lectures", async () => {
      const a = await ytLecture();
      const b = await ytLecture();
      expect((await row(b)).order).toBeGreaterThan((await row(a)).order);
    });
  });

  describe("stream route", () => {
    let yt: string;
    let ytDraft: string;
    let up: string;
    beforeAll(async () => {
      yt = await ytLecture({ publish: true });
      ytDraft = await ytLecture();
      up = await uploadLecture({ publish: true });
    });

    it("an enrolled student gets the id and nothing else, with no Storage or CDN call", async () => {
      actAs(SEED.student.id);
      storage.calls.length = 0;
      const res = await stream(yt);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ source: "youtube", videoId: ID });
      expect(storage.calls).toEqual([]);
    });

    it("401 signed out; 404 not enrolled, draft, other professor's draft, unknown and malformed ids", async () => {
      actAs(null);
      expect((await stream(yt)).status).toBe(401);
      actAs(SEED.student2.id);
      const hidden = await stream(yt);
      expect(hidden.status).toBe(404);
      expect(JSON.stringify(await hidden.json())).not.toContain(ID);
      actAs(SEED.student.id);
      const draft = await stream(ytDraft);
      expect(draft.status).toBe(404);
      expect(JSON.stringify(await draft.json())).not.toContain(ID);
      expect((await stream(randomUUID())).status).toBe(404);
      expect((await stream("not-a-uuid")).status).toBe(404);
      actAs(SEED.profB.id);
      expect((await stream(ytDraft)).status).toBe(404);
      expect((await stream(yt)).status).toBe(404);
    });

    it("the owning professor can preview a draft", async () => {
      actAs(SEED.profA.id);
      const res = await stream(ytDraft);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ source: "youtube", videoId: ID });
    });

    it("an uploaded lecture is unchanged apart from the source field", async () => {
      actAs(SEED.student.id);
      storage.calls.length = 0;
      const res = await stream(up);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual(["expiresAt", "source", "url"]);
      expect(body.source).toBe("upload");
      expect(body.url).toContain(`lectures/${up}/video.mp4`);
      expect(storage.calls).toEqual([`createLectureStreamUrl:courses/${courseId}/lectures/${up}/video.mp4`, `toCdnUrl:courses/${courseId}/lectures/${up}/video.mp4`]);
    });

    it("no student-facing list or view leaks the id", async () => {
      const { getCourseForStudent } = await import("@/lib/data/courses");
      const course = await getCourseForStudent(courseId, SEED.student.id);
      expect(JSON.stringify(course)).not.toContain(ID);
      expect(JSON.stringify(course)).not.toContain("youtube");
    });
  });

  describe("progress on a YouTube lecture", () => {
    it("runs the same server rules: bursts ignored, real pace completes at 95%", async () => {
      const id = await ytLecture({ publish: true, duration: 100 });
      actAs(SEED.student.id);
      const first = await post(id, { from: 0, to: 10, position: 10 });
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ accepted: true, percent: 10, completed: false, intervals: [[0, 10]] });
      const burst = await post(id, { from: 10, to: 30 });
      expect(await burst.json()).toEqual({ accepted: false, reason: "too_fast" });

      const base = new Date(Date.now() + 60_000);
      let t = 10;
      for (let i = 0; t < 100; i++) {
        const r = await recordProgress(id, SEED.student.id, { from: t, to: t + 10 }, t + 10, new Date(base.getTime() + (i + 1) * 10_000));
        expect(r.ok, `segment ${t}`).toBe(true);
        t += 10;
      }
      expect((openView(await getLectureForViewer(id, STUDENT))).progress).toMatchObject({ completed: true, percent: 100 });
    });

    it("a YouTube lecture never accrues progress for the previewing professor or an outsider, or when a draft", async () => {
      const id = await ytLecture({ publish: true });
      const draft = await ytLecture();
      actAs(SEED.profA.id);
      expect((await post(id, { from: 0, to: 5 })).status).toBe(404);
      actAs(SEED.student2.id);
      expect((await post(id, { from: 0, to: 5 })).status).toBe(404);
      actAs(SEED.student.id);
      expect((await post(draft, { from: 0, to: 5 })).status).toBe(404);
    });
  });

  it("insertYoutubeLecture is only reachable with an id the CHECK accepts", async () => {
    await expect(
      insertYoutubeLecture({ id: randomUUID(), courseId, title: "bad", description: null, youtubeVideoId: "short", durationSeconds: 60 }),
    ).rejects.toThrow();
    await expect(
      insertYoutubeLecture({ id: randomUUID(), courseId, title: "bad2", description: null, youtubeVideoId: ID, durationSeconds: 0 }),
    ).rejects.toThrow();
  });
});

