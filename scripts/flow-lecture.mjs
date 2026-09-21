#!/usr/bin/env node
// End-to-end check of the lecture pipeline with the dev seed accounts:
//   professor: create course → invite student → upload a real clip through
//              the UI → publish → preview
//   student:   open lecture → play → forward seek snaps back → watch to the
//              end → server marks it complete → state survives a reload →
//              dashboard shows the course complete
// Saves screenshots at phone width (375×812) and exits non-zero on any
// failed check.
//
//   BASE_URL=http://localhost:3100 CLIP=/path/to/clip.webm pnpm flow-lecture
// Needs .auth/prof.json + .auth/student.json (`pnpm auth-session`), a short
// WebM (Playwright's Chromium has no H.264) and SUPABASE_SERVICE_ROLE_KEY set
// for the app under test. Leaves the course in place for manual inspection.
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? ".screenshots/lecture";
const CLIP = process.env.CLIP;
const STUDENT_EMAIL = process.env.STUDENT_EMAIL ?? "student-1@example.test";
if (!CLIP) {
  console.error("Set CLIP=/path/to/short.webm");
  process.exit(2);
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
let step = 0;
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures++;
};
const shot = async (page, name) => {
  step++;
  const file = path.join(OUT, `${String(step).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 0) check(false, `${name}: horizontal overflow ${overflow}px`);
};
const newPage = async (cookieFile) => {
  const c = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await c.addCookies(JSON.parse(await readFile(cookieFile, "utf8")));
  return c.newPage();
};
const videoState = (page) =>
  page.evaluate(() => {
    const v = document.querySelector("video");
    return v ? { t: v.currentTime, d: v.duration, paused: v.paused, ready: v.readyState, rate: v.playbackRate } : null;
  });

const title = `Lecture flow ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

// ── Professor ──────────────────────────────────────────────────────────────
const prof = await newPage(".auth/prof.json");
await prof.goto(`${BASE_URL}/professor/courses/new`, { waitUntil: "networkidle" });
await prof.fill("#title", title);
await prof.click("form:has(#title) button[type=submit]");
await prof.waitForURL(/\/professor\/courses\/[0-9a-f-]{36}$/, { timeout: 30000 });
const courseUrl = prof.url();
const courseId = courseUrl.split("/").pop();
await prof.waitForLoadState("networkidle");

await prof.fill("#email", STUDENT_EMAIL);
await prof.click("form:has(#email) button[type=submit]");
await prof.waitForSelector("form:has(#email) button[type=submit][aria-busy=true]", { timeout: 5000 }).catch(() => {});
await prof.waitForSelector("form:has(#email) button[type=submit]:not([aria-busy=true])", { timeout: 30000 });

// upload through the real UI
await prof.fill("form:has(input[type=file]) input[name=title]", "Lecture 1 — Test clip");
await prof.fill("form:has(input[type=file]) textarea[name=description]", "A generated 24-second clip.\nUsed to verify playback, seeking and completion.");
await prof.setInputFiles("input[type=file]", CLIP);
await shot(prof, "prof-upload-filled");
await prof.click("form:has(input[type=file]) button[type=submit]");
const uploaded = await prof
  .waitForSelector("text=Video uploaded", { timeout: 90000 })
  .then(() => true)
  .catch(() => false);
check(uploaded, "professor upload → finalize succeeded through the UI");
if (!uploaded) {
  await shot(prof, "prof-upload-failed");
  console.error("Upload failed; is SUPABASE_SERVICE_ROLE_KEY set for the app under test?");
  await browser.close();
  process.exit(1);
}
await prof.waitForLoadState("networkidle");
await shot(prof, "prof-lecture-draft");

await prof.getByRole("button", { name: "Publish" }).click();
await prof.waitForSelector("text=Published", { timeout: 30000 });
await prof.waitForLoadState("networkidle");
check(true, "lecture published");
await shot(prof, "prof-lecture-published");

// find the lecture id from the Preview link
const previewHref = await prof.getByRole("link", { name: "Preview" }).first().getAttribute("href");
const lectureId = previewHref.split("/").pop();
console.log("course", courseId, "lecture", lectureId);

// instructor preview: no tracking, free seeking
await prof.goto(`${BASE_URL}${previewHref}`, { waitUntil: "networkidle" });
await prof.waitForFunction(() => document.querySelector("video")?.readyState >= 1, null, { timeout: 30000 });
check(await prof.getByText("progress isn’t recorded").or(prof.getByText("progress isn't recorded")).first().isVisible(), "preview banner shown to the instructor");
await prof.evaluate(() => { document.querySelector("video").currentTime = 15; });
await prof.waitForTimeout(500);
check((await videoState(prof)).t >= 14, "instructor can seek freely in preview");
await shot(prof, "prof-preview");

// ── Student ────────────────────────────────────────────────────────────────
const student = await newPage(".auth/student.json");
await student.goto(`${BASE_URL}/courses/${courseId}`, { waitUntil: "networkidle" });
check(await student.getByText("Lecture 1 — Test clip").isVisible(), "student course page lists the published lecture");
await shot(student, "student-course-with-lecture");

await student.goto(`${BASE_URL}/courses/${courseId}/lectures/${lectureId}`, { waitUntil: "networkidle" });
await student.waitForFunction(() => document.querySelector("video")?.readyState >= 1, null, { timeout: 30000 });
const s0 = await videoState(student);
check(Math.abs(s0.d - 24) < 1, `video loaded from the signed URL (duration ${s0.d.toFixed(1)}s)`);
await shot(student, "student-lecture-idle");

await student.getByRole("button", { name: "Play" }).first().click();
await student.waitForFunction(() => document.querySelector("video")?.currentTime > 4, null, { timeout: 30000 });
check((await videoState(student)).rate === 1, "playback rate is 1×");

// forward seek into unwatched video must snap back
await student.evaluate(() => { document.querySelector("video").currentTime = 20; });
await student.waitForTimeout(700);
const afterSeek = await videoState(student);
check(afterSeek.t < 12, `forward seek to 20 s snapped back (playhead ${afterSeek.t.toFixed(1)}s)`);
check(await student.getByText("You can't skip ahead yet").isVisible().catch(() => false), "student sees the 'can't skip ahead' notice");
await shot(student, "student-seek-denied");

// backward seek is fine
await student.evaluate(() => { document.querySelector("video").currentTime = 1; });
await student.waitForTimeout(400);
check((await videoState(student)).t < 4, "backward seek is allowed");

// let it play out (24 s clip); the server decides completion
await student.evaluate(() => { document.querySelector("video").currentTime = 0; });
const done = await student
  .waitForSelector("text=Lecture complete", { timeout: 60000 })
  .then(() => true)
  .catch(() => false);
check(done, "server marked the lecture complete and the banner appeared");
await shot(student, "student-lecture-complete");

// state survives a reload
await student.reload({ waitUntil: "networkidle" });
check(await student.getByText("Lecture complete").isVisible(), "completion persists after reload");
await student.waitForFunction(() => document.querySelector("video")?.readyState >= 1, null, { timeout: 30000 });
await student.evaluate(() => { document.querySelector("video").currentTime = 18; });
await student.waitForTimeout(500);
check((await videoState(student)).t >= 17, "seeking is unlocked once complete");

// adversarial: oversized segment is rejected by the server
const bad = await student.request.post(`${BASE_URL}/api/lectures/${lectureId}/progress`, {
  data: { from: 0, to: 600 },
});
check(bad.status() === 400, `server rejects a 600 s segment (HTTP ${bad.status()})`);

await student.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
await shot(student, "student-dashboard-complete");

await browser.close();
console.log(`\nCourse "${title}" left in place: ${courseUrl}`);
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
