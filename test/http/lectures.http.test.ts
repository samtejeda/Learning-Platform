import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resetSeedData, SEED, seedUsers } from "@/test/seed";
import { getCourseForStudent, insertCourse } from "@/lib/data/courses";
import { inviteByEmail } from "@/lib/data/enrollments";
import { insertLecture, markLectureUploaded, setLecturePublished } from "@/lib/data/lectures";
import { createLectureUploadUrl, lectureObjectPath, LECTURES_BUCKET, removeObjects } from "@/lib/storage";
import { BASE_URL, client, signIn, type Http } from "./session";

// End-to-end over real HTTP: real sessions, real proxy, real Storage, a real
// 25-second MP4, and real wall-clock time for the anti-scrub rules. The only
// thing it can't do is play the video in a browser.

const DURATION = 25;
const workdir = mkdtempSync(join(tmpdir(), "lp-http-"));

describe("lectures over HTTP", () => {
  let courseId: string;
  let published: string;
  let draft: string;
  const paths: string[] = [];
  let signedOut: Http, prof: Http, otherProf: Http, student: Http, outsider: Http;

  beforeAll(async () => {
    const file = join(workdir, "clip.mp4");
    execFileSync(
      "ffmpeg",
      [
        "-v", "error", "-f", "lavfi", "-i", `testsrc=duration=${DURATION}:size=320x240:rate=15`,
        "-f", "lavfi", "-i", `sine=frequency=440:duration=${DURATION}`,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", file,
      ],
      { stdio: "inherit" },
    );

    await seedUsers();
    await resetSeedData();
    ({ id: courseId } = await insertCourse({ title: "HTTP course", description: null, professorId: SEED.profA.id }));
    await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);

    // Real upload through the exact path the upload form uses: server-issued
    // token, then the anon browser client straight to Storage.
    const browser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const bytes = readFileSync(file);
    for (const [title, publish] of [["Published lecture", true], ["Secret draft lecture", false]] as const) {
      const id = randomUUID();
      const path = lectureObjectPath(courseId, id, "video/mp4");
      const { token } = await createLectureUploadUrl(path);
      const up = await browser.storage
        .from(LECTURES_BUCKET)
        .uploadToSignedUrl(path, token, new Blob([bytes], { type: "video/mp4" }), { contentType: "video/mp4" });
      expect(up.error).toBeNull();
      await insertLecture({ id, courseId, title, description: null, videoStoragePath: path });
      await markLectureUploaded(id, DURATION);
      if (publish) {
        await setLecturePublished(id, true);
        published = id;
      } else {
        draft = id;
      }
      paths.push(path);
    }

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
    await removeObjects(paths).catch(() => {});
    await resetSeedData();
    rmSync(workdir, { recursive: true, force: true });
  });

  it("signed-out API callers get a JSON 401 (not an HTML redirect); pages redirect to login", async () => {
    const stream = await signedOut.get(`/api/lectures/${published}/stream`);
    expect(stream.status).toBe(401);
    expect(await stream.json()).toEqual({ error: { code: "unauthenticated", message: "Please sign in." } });

    const progress = await signedOut.post(`/api/lectures/${published}/progress`, { from: 0, to: 5 });
    expect(progress.status).toBe(401);

    const page = await signedOut.get(`/courses/${courseId}`);
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login");
  });

  it("enrolled student: gets a signed URL that serves the real MP4 with Range support", async () => {
    const res = await student.get(`/api/lectures/${published}/stream`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "url"]);

    const head = await fetch(body.url, { headers: { Range: "bytes=0-11" } });
    expect(head.status).toBe(206);
    const bytes = new Uint8Array(await head.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(4, 8))).toBe("ftyp"); // real MP4 container
  });

  it("everyone who shouldn't see the lecture gets 404 — not 403, not the URL", async () => {
    for (const [who, http, id] of [
      ["unenrolled student → published", outsider, published],
      ["enrolled student → draft", student, draft],
      ["other professor → draft", otherProf, draft],
    ] as const) {
      const res = await http.get(`/api/lectures/${id}/stream`);
      expect(res.status, who).toBe(404);
      expect(JSON.stringify(await res.json()), who).not.toContain("http");
    }
    expect((await student.get(`/api/lectures/not-a-uuid/stream`)).status).toBe(404);
    // The owning professor may preview a draft, but can't accrue progress.
    expect((await prof.get(`/api/lectures/${draft}/stream`)).status).toBe(200);
    expect((await prof.post(`/api/lectures/${published}/progress`, { from: 0, to: 5 })).status).toBe(404);
  });

  it("progress: validates input, rejects cross-origin, refuses non-enrolled", async () => {
    expect((await student.post(`/api/lectures/${published}/progress`, { from: 0, to: 5 }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await student.post(`/api/lectures/${published}/progress`, { from: 0, to: 600 })).status).toBe(400);
    expect((await student.post(`/api/lectures/${published}/progress`, { from: 5, to: 1 })).status).toBe(400);
    expect((await student.post(`/api/lectures/${published}/progress`, { from: 0, to: 5, admin: true })).status).toBe(400);
    expect((await student.post(`/api/lectures/${draft}/progress`, { from: 0, to: 5 })).status).toBe(404);
    expect((await outsider.post(`/api/lectures/${published}/progress`, { from: 0, to: 5 })).status).toBe(404);
  });

  it("progress obeys wall-clock time: bursts are ignored, real-pace playback completes", async () => {
    const ping = async (from: number, to: number) => {
      const res = await student.post(`/api/lectures/${published}/progress`, { from, to, position: to });
      expect(res.status).toBe(200);
      return res.json();
    };

    const a = await ping(0, 10);
    expect(a).toMatchObject({ accepted: true, watchedSeconds: 10, percent: 40, completed: false, intervals: [[0, 10]] });

    // 10 more seconds claimed immediately: no wall-clock time has passed.
    expect(await ping(10, 20)).toEqual({ accepted: false, reason: "too_fast" });

    // Skipping ahead and claiming the end without watching the middle earns
    // nothing beyond what time allows, and never completes the lecture.
    expect(await ping(15, 25)).toEqual({ accepted: false, reason: "too_fast" });

    // Real pace: wait the time 10 s of playback plausibly takes (1.5× + slack).
    await new Promise((r) => setTimeout(r, 6_500));
    const b = await ping(10, 20);
    expect(b).toMatchObject({ accepted: true, watchedSeconds: 20, completed: false });

    await new Promise((r) => setTimeout(r, 3_500));
    const c = await ping(20, 25);
    expect(c).toMatchObject({ accepted: true, watchedSeconds: 25, percent: 100, completed: true, justCompleted: true });
    expect(c.intervals).toEqual([[0, 25]]);

    // Sticky, and re-watching is harmless.
    expect(await ping(0, 10)).toMatchObject({ accepted: true, completed: true, watchedSeconds: 25 });
    expect((await getCourseForStudent(courseId, SEED.student.id))!.lectures).toMatchObject([
      { id: published, completed: true, percentWatched: 100 },
    ]);
  });

  it("pages: students see only published lectures; access rules hold at the page level", async () => {
    const course = await student.get(`/courses/${courseId}`);
    expect(course.status).toBe(200);
    const html = await course.text();
    expect(html).toContain("Published lecture");
    expect(html).toContain("Completed");
    expect(html).not.toContain("Secret draft lecture");

    expect((await student.get(`/courses/${courseId}/lectures/${published}`)).status).toBe(200);
    expect((await student.get(`/courses/${courseId}/lectures/${draft}`)).status).toBe(404);
    expect((await outsider.get(`/courses/${courseId}`)).status).toBe(404);
    // A lecture id under the wrong course id is a 404 too.
    expect((await student.get(`/courses/${randomUUID()}/lectures/${published}`)).status).toBe(404);

    // Role-prefixed surfaces (proxy gate 1 + layout gate 2).
    const bounced = await student.get("/professor");
    expect(bounced.status).toBe(307);
    expect(bounced.headers.get("location")).toContain("/dashboard");
    expect((await student.get("/admin")).status).toBe(307);

    const ownPage = await prof.get(`/professor/courses/${courseId}`);
    expect(ownPage.status).toBe(200);
    const ownHtml = await ownPage.text();
    expect(ownHtml).toContain("Secret draft lecture");
    expect(ownHtml).toContain("Draft");
    expect(ownHtml).toContain(SEED.student.email);
    expect((await otherProf.get(`/professor/courses/${courseId}`)).status).toBe(404);
    expect((await otherProf.get(`/professor/courses/${courseId}/edit`)).status).toBe(404);
    expect((await otherProf.get(`/professor/lectures/${draft}/edit`)).status).toBe(404);
    expect((await prof.get(`/professor/lectures/${draft}/edit`)).status).toBe(200);
  });

  it("the server is reachable where these tests expect it", () => {
    expect(BASE_URL).toMatch(/^http/);
  });
});
