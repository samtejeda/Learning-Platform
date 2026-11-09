import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { resetSeedData, SEED, seedUsers } from "@/test/seed";
import { getCourseForStudent, insertCourse } from "@/lib/data/courses";
import { inviteByEmail } from "@/lib/data/enrollments";
import { insertLecture, insertYoutubeLecture, markLectureUploaded, setLecturePublished } from "@/lib/data/lectures";
import { createClient } from "@supabase/supabase-js";
import { createLectureUploadUrl, lectureObjectPath, LECTURES_BUCKET, removeObjects } from "@/lib/storage";
import { client, signIn, type Http } from "./session";

// End-to-end over real HTTP for lectures whose video is an embedded YouTube
// video: real sessions, real proxy, real wall-clock time for the anti-scrub
// rules. The server never contacts YouTube, so nothing here needs the network.

const ID = "dQw4w9WgXcQ";
const DURATION = 25;

describe("YouTube lectures over HTTP", () => {
  let courseId: string;
  let published: string;
  let draft: string;
  let uploaded: string;
  let uploadedPath: string;
  let signedOut: Http, prof: Http, otherProf: Http, student: Http, outsider: Http;

  beforeAll(async () => {
    await seedUsers();
    await resetSeedData();
    ({ id: courseId } = await insertCourse({ title: "YouTube HTTP course", description: null, professorId: SEED.profA.id }));
    await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);

    published = randomUUID();
    draft = randomUUID();
    uploaded = randomUUID();
    await insertYoutubeLecture({ id: published, courseId, title: "YT published", description: null, youtubeVideoId: ID, durationSeconds: DURATION });
    await setLecturePublished(published, true);
    await insertYoutubeLecture({ id: draft, courseId, title: "YT secret draft", description: null, youtubeVideoId: ID, durationSeconds: DURATION });
    // An uploaded lecture alongside (a course may mix both). A tiny placeholder
    // object goes through the real upload path so a signed URL can be minted.
    uploadedPath = lectureObjectPath(courseId, uploaded, "video/mp4");
    const { token } = await createLectureUploadUrl(uploadedPath);
    const browser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const up = await browser.storage
      .from(LECTURES_BUCKET)
      .uploadToSignedUrl(uploadedPath, token, new Blob([new Uint8Array(32)], { type: "video/mp4" }), { contentType: "video/mp4" });
    expect(up.error).toBeNull();
    await insertLecture({ id: uploaded, courseId, title: "Uploaded", description: null, videoStoragePath: uploadedPath });
    await markLectureUploaded(uploaded, DURATION);
    await setLecturePublished(uploaded, true);

    const [pc, opc, sc, oc] = await Promise.all([
      signIn(SEED.profA.email),
      signIn(SEED.profB.email),
      signIn(SEED.student.email),
      signIn(SEED.student2.email),
    ]);
    signedOut = client();
    prof = client(pc);
    otherProf = client(opc);
    student = client(sc);
    outsider = client(oc);
  });

  afterAll(async () => {
    await removeObjects([uploadedPath]).catch(() => {});
    await resetSeedData();
  });

  it("stream: enrolled student gets the id (and only the id), never cached", async () => {
    const res = await student.get(`/api/lectures/${published}/stream`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ source: "youtube", videoId: ID });
  });

  it("stream: signed-out 401; not enrolled, draft, other professor, unknown and malformed ids are all 404 without the id", async () => {
    expect((await signedOut.get(`/api/lectures/${published}/stream`)).status).toBe(401);
    for (const [who, http, id] of [
      ["unenrolled student → published", outsider, published],
      ["enrolled student → draft", student, draft],
      ["other professor → draft", otherProf, draft],
      ["other professor → published", otherProf, published],
      ["student → unknown id", student, randomUUID()],
      ["student → malformed id", student, "not-a-uuid"],
    ] as const) {
      const res = await http.get(`/api/lectures/${id}/stream`);
      expect(res.status, who).toBe(404);
      expect(JSON.stringify(await res.json()), who).not.toContain(ID);
    }
    // The owning professor may preview a draft.
    const preview = await prof.get(`/api/lectures/${draft}/stream`);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({ source: "youtube", videoId: ID });
  });

  it("stream: an uploaded lecture in the same course is unchanged ({ url, expiresAt } plus the source)", async () => {
    const res = await student.get(`/api/lectures/${uploaded}/stream`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "source", "url"]);
    expect(body.source).toBe("upload");
    expect(body.url).toContain(`lectures/${uploaded}/video.mp4`);
  });

  it("progress: input rules and access are the same as for uploads", async () => {
    const url = `/api/lectures/${published}/progress`;
    expect((await student.post(url, { from: 0, to: 5 }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await signedOut.post(url, { from: 0, to: 5 })).status).toBe(401);
    expect((await student.post(url, { from: 0, to: 600 })).status).toBe(400);
    expect((await student.post(url, { from: 0, to: 5, durationSeconds: 1 })).status).toBe(400); // a student can't supply a duration
    expect((await student.post(`/api/lectures/${draft}/progress`, { from: 0, to: 5 })).status).toBe(404);
    expect((await outsider.post(url, { from: 0, to: 5 })).status).toBe(404);
    expect((await prof.post(url, { from: 0, to: 5 })).status).toBe(404);
  });

  it("progress obeys wall-clock time on a YouTube lecture: bursts ignored, real pace completes", async () => {
    const ping = async (from: number, to: number) => {
      const res = await student.post(`/api/lectures/${published}/progress`, { from, to, position: to });
      expect(res.status).toBe(200);
      return res.json();
    };
    expect(await ping(0, 10)).toMatchObject({ accepted: true, watchedSeconds: 10, percent: 40, completed: false });
    expect(await ping(10, 20)).toEqual({ accepted: false, reason: "too_fast" });
    expect(await ping(15, 25)).toEqual({ accepted: false, reason: "too_fast" });

    await new Promise((r) => setTimeout(r, 6_500));
    expect(await ping(10, 20)).toMatchObject({ accepted: true, watchedSeconds: 20, completed: false });
    await new Promise((r) => setTimeout(r, 3_500));
    expect(await ping(20, 25)).toMatchObject({ accepted: true, percent: 100, completed: true, justCompleted: true });

    const lectures = (await getCourseForStudent(courseId, SEED.student.id))!.lectures;
    expect(lectures.find((l) => l.id === published)).toMatchObject({ completed: true, percentWatched: 100 });
  });

  it("pages: the lecture list and course page never contain the YouTube id", async () => {
    const course = await student.get(`/courses/${courseId}`);
    expect(course.status).toBe(200);
    const html = await course.text();
    expect(html).toContain("YT published");
    expect(html).not.toContain("YT secret draft");
    expect(html).not.toContain(ID);
  });
});
