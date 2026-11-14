import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { lectureProgress } from "@/lib/db/schema";
import { resetSeedData, SEED, seedUsers } from "@/test/seed";
import { insertCourse } from "@/lib/data/courses";
import { inviteByEmail } from "@/lib/data/enrollments";
import { insertLecture, insertYoutubeLecture, markLectureUploaded, setLecturePublished } from "@/lib/data/lectures";
import { getOwnedComprehension, saveOwnedComprehension, setOwnedComprehensionEnabled } from "@/lib/data/lecture-comprehension";
import { unlockStudentForLecture } from "@/lib/data/lecture-unlocks";
import { createLectureUploadUrl, lectureObjectPath, LECTURES_BUCKET, removeObjects } from "@/lib/storage";
import { client, signIn, type Http } from "./session";

// Comprehension locks over real HTTP: real sessions, real proxy, the real
// stream and progress routes. L1 (YouTube) has the question; L2 (upload) and L3
// (YouTube) follow it, so the lock is proven for BOTH video sources. Wording is
// placeholders only. Completion is written directly (honest playback takes
// real time and is covered in lectures.http.test.ts).

const YT = "dQw4w9WgXcQ";
const A = { id: SEED.profA.id, role: "professor" as const };

describe("comprehension locks over HTTP", () => {
  let courseId: string;
  let l1: string, l2: string, l3: string;
  let l2Path: string;
  let signedOut: Http, prof: Http, otherProf: Http, student: Http, student2: Http;

  const streamStatus = async (http: Http, id: string) => (await http.get(`/api/lectures/${id}/stream`)).status;
  const pingStatus = async (http: Http, id: string) => (await http.post(`/api/lectures/${id}/progress`, { from: 0, to: 5, position: 5 })).status;

  beforeAll(async () => {
    await seedUsers();
    await resetSeedData();
    ({ id: courseId } = await insertCourse({ title: "HTTP locks", description: null, professorId: SEED.profA.id }));
    await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);
    await inviteByEmail(courseId, SEED.student2.email, SEED.profA.id);

    l1 = randomUUID();
    l2 = randomUUID();
    l3 = randomUUID();
    await insertYoutubeLecture({ id: l1, courseId, title: "L1 question", description: null, youtubeVideoId: YT, durationSeconds: 100 });
    expect(
      (
        await saveOwnedComprehension(l1, A, [
          {
            kind: "question",
            columns: {
              promptEs: "Question (es)",
              promptEn: "Question (en)",
              optionsEs: ["A (es)", "B (es)", "C (es)"],
              optionsEn: ["A (en)", "B (en)", "C (en)"],
              correctOption: 1,
            },
          },
          { kind: "blank" },
        ])
      ).ok,
    ).toBe(true);
    expect((await setOwnedComprehensionEnabled(l1, A, true)).ok).toBe(true);
    expect(await setLecturePublished(l1, true)).toBe(true);

    // L2 is an uploaded lecture: a tiny placeholder object goes through the real
    // upload path so unlocking can mint a real signed URL.
    l2Path = lectureObjectPath(courseId, l2, "video/mp4");
    const { token } = await createLectureUploadUrl(l2Path);
    const browser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const up = await browser.storage
      .from(LECTURES_BUCKET)
      .uploadToSignedUrl(l2Path, token, new Blob([new Uint8Array(32)], { type: "video/mp4" }), { contentType: "video/mp4" });
    expect(up.error).toBeNull();
    await insertLecture({ id: l2, courseId, title: "L2 upload", description: null, videoStoragePath: l2Path });
    await markLectureUploaded(l2, 100);
    expect(await setLecturePublished(l2, true)).toBe(true);

    await insertYoutubeLecture({ id: l3, courseId, title: "L3 youtube", description: null, youtubeVideoId: YT, durationSeconds: 100 });
    expect(await setLecturePublished(l3, true)).toBe(true);

    const [pc, opc, sc, s2c] = await Promise.all([
      signIn(SEED.profA.email),
      signIn(SEED.profB.email),
      signIn(SEED.student.email),
      signIn(SEED.student2.email),
    ]);
    signedOut = client();
    prof = client(pc);
    otherProf = client(opc);
    student = client(sc);
    student2 = client(s2c);
  });

  afterAll(async () => {
    await removeObjects([l2Path]).catch(() => {});
    await resetSeedData();
  });

  it("an upload lecture and a YouTube lecture behind an uncleared question cannot be streamed", async () => {
    for (const id of [l2, l3]) {
      const res = await student.get(`/api/lectures/${id}/stream`);
      expect(res.status, id).toBe(403);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const text = JSON.stringify(await res.json());
      expect(JSON.parse(text).error.code).toBe("locked");
      expect(text).not.toMatch(/videoId|"url"|storage|dQw4/i);
    }
    // The first lecture is open, and a signed-out caller is still 401.
    expect(await streamStatus(student, l1)).toBe(200);
    expect(await streamStatus(signedOut, l2)).toBe(401);
  });

  it("progress cannot be recorded for either, and a refused ping does not unlock anything", async () => {
    for (const id of [l2, l3]) {
      const res = await student.post(`/api/lectures/${id}/progress`, { from: 0, to: 5, position: 5 });
      expect(res.status, id).toBe(403);
      expect((await res.json()).error.code).toBe("locked");
    }
    expect(await streamStatus(student, l2)).toBe(403); // still locked: the refused pings made no progress row
  });

  it("the lecture page for a locked lecture is a placeholder with no player and no video id", async () => {
    const page = await student.get(`/courses/${courseId}/lectures/${l3}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("opens after you finish the previous lecture");
    expect(html).not.toContain(YT);
    expect(html).not.toMatch(/youtube/i);
  });

  it("the owning professor previews locked lectures; another professor gets 404", async () => {
    expect(await streamStatus(prof, l2)).toBe(200);
    expect(await streamStatus(prof, l3)).toBe(200);
    expect(await streamStatus(otherProf, l2)).toBe(404);
  });

  it("failing the question twice keeps it locked ('blocked'), and the teacher's unlock opens both", async () => {
    await db.insert(lectureProgress).values({ studentId: SEED.student.id, lectureId: l1, completed: true, completedAt: new Date(), watchedSeconds: 100 });
    const key = (await getOwnedComprehension(l1, A))!.questions[0].correctOption!;
    const wrong = (key + 1) % 3;
    const first = await student.post(`/api/lectures/${l1}/comprehension`, { selectedOption: wrong });
    expect(await first.json()).toMatchObject({ correct: false, status: "retry" });
    const second = await student.post(`/api/lectures/${l1}/comprehension`, { selectedOption: wrong });
    expect(await second.json()).toMatchObject({ correct: false, status: "blocked" });
    expect(await streamStatus(student, l2)).toBe(403);
    expect(await pingStatus(student, l3)).toBe(403);

    // Another professor can't unlock; the owner can, and it is idempotent.
    expect(await unlockStudentForLecture(l1, SEED.student.id, { id: SEED.profB.id, role: "professor" })).toEqual({ ok: false, reason: "not_found" });
    expect(await streamStatus(student, l2)).toBe(403);
    expect(await unlockStudentForLecture(l1, SEED.student.id, A)).toMatchObject({ ok: true, created: true });
    expect(await unlockStudentForLecture(l1, SEED.student.id, A)).toMatchObject({ ok: true, created: false });

    const up = await student.get(`/api/lectures/${l2}/stream`);
    expect(up.status).toBe(200);
    expect(Object.keys(await up.json()).sort()).toEqual(["expiresAt", "source", "url"]);
    const yt = await student.get(`/api/lectures/${l3}/stream`);
    expect(yt.status).toBe(200);
    expect(await yt.json()).toEqual({ source: "youtube", videoId: YT });
    expect(await pingStatus(student, l2)).toBe(200);
    expect(await pingStatus(student, l3)).toBe(200);

    // The other student is untouched by this unlock.
    expect(await streamStatus(student2, l2)).toBe(403);
  });

  it("a lecture the student already started stays open even though the question is uncleared", async () => {
    expect(await streamStatus(student2, l2)).toBe(403);
    // Simulates a student who began L2 before the question existed.
    await db.insert(lectureProgress).values({ studentId: SEED.student2.id, lectureId: l2, watchedSeconds: 5 });
    expect(await streamStatus(student2, l2)).toBe(200);
    expect(await pingStatus(student2, l2)).toBe(200);
    // L3 follows L2, which has no question and is open, so it is open too.
    expect(await streamStatus(student2, l3)).toBe(200);
  });
});
