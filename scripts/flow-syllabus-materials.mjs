#!/usr/bin/env node
// End-to-end walk of the Syllabus + Course Materials screens at phone width
// with the dev seed accounts, against a real Supabase project (uploads a
// tiny generated PDF to the private course-files bucket, then removes it).
//
//   BASE_URL=http://localhost:3100 pnpm flow-syllabus-materials
// Requires .auth/prof.json and .auth/student.json from `pnpm auth-session`.
// Leaves the (empty) audit course behind; it has no storage objects.
//
// Proves: syllabus uploads through the UI with no publish step; materials
// are draft-gated; the student sees syllabus + published materials only;
// tapping the syllabus / a file material opens a signed URL in a NEW TAB;
// there is no <iframe> on either course page; no horizontal overflow at 375px.
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? ".screenshots/flow-syllabus";
const STUDENT_EMAIL = process.env.STUDENT_EMAIL ?? "student-1@example.test";
const title = `Audit syllabus ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

const PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF\n",
);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
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
  check(overflow <= 0, `${name}: no horizontal overflow${overflow > 0 ? ` (${overflow}px)` : ""}`);
};
const ctx = async (cookieFile) => {
  const c = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addCookies(JSON.parse(await readFile(cookieFile, "utf8")));
  return c;
};
const matForm = "form:has(input[name=kind])";
const waitSaved = async (page) => {
  await page.waitForSelector(`${matForm} [role=status]:has-text("Saved")`, { timeout: 45000 });
  await page.waitForLoadState("networkidle");
};

// ── Professor ──────────────────────────────────────────────────────────────
const profCtx = await ctx(".auth/prof.json");
const prof = await profCtx.newPage();
prof.on("dialog", (d) => d.accept());
await prof.goto(`${BASE_URL}/professor/courses/new`, { waitUntil: "networkidle" });
await prof.fill("#title", title);
await prof.fill("#description", "Course used to check syllabus + materials screens.");
await prof.click("form:has(#title) button[type=submit]");
await prof.waitForURL(/\/professor\/courses\/[0-9a-f-]{36}$/, { timeout: 30000 });
const courseUrl = prof.url();
const courseId = courseUrl.split("/").pop();
console.log("created", courseUrl);
await prof.waitForLoadState("networkidle");
await shot(prof, "prof-course-empty");

// invite the student so they can see it
await prof.fill("form:has(#email) #email", STUDENT_EMAIL);
await prof.click("form:has(#email) button[type=submit]");
await prof.waitForSelector("form:has(#email) button[type=submit]:not([aria-busy=true])", { timeout: 30000 });
await prof.waitForLoadState("networkidle");

// syllabus: upload → visible immediately, no publish step
await prof.setInputFiles("form:has(input[name=file]):not(:has(input[name=kind])) input[name=file] >> nth=-1", {
  name: "syllabus.pdf",
  mimeType: "application/pdf",
  buffer: PDF,
});
await shot(prof, "prof-syllabus-file-chosen");
const syllabusForm = prof.locator("form:has(input[name=file]):not(:has(input[name=kind]))").last();
await syllabusForm.locator("button[type=submit]").click();
await prof.waitForSelector("text=Syllabus uploaded.", { timeout: 45000 });
await prof.waitForLoadState("networkidle");
check(await prof.locator("text=Visible to students").count() > 0, "syllabus visible to students with no publish step");
check((await prof.locator("button:has-text('Publish')").count()) === 0, "no Publish control exists for the syllabus");
await shot(prof, "prof-syllabus-uploaded");

// materials: a link and a file; both start as drafts
await prof.click(`${matForm} label:has-text("Add a link")`);
await prof.fill(`${matForm} input[name=title]`, "Reading list");
await prof.fill(`${matForm} textarea[name=description]`, "External reading for week 1.");
await prof.fill(`${matForm} input[name=url]`, "https://example.com/reading");
// invalid URL: per-field error shown, typed values kept
await prof.fill(`${matForm} input[name=url]`, "not a url");
await prof.click(`${matForm} button[type=submit]`);
await prof.waitForSelector(`${matForm} [id$="-error"], ${matForm} #url-error, ${matForm} p.text-error`, { timeout: 15000 });
check((await prof.inputValue(`${matForm} input[name=title]`)) === "Reading list", "invalid link keeps the typed title");
check((await prof.inputValue(`${matForm} input[name=url]`)) === "not a url", "invalid link keeps the typed URL");
check((await prof.locator(`${matForm} input[name=url][aria-invalid=true]`).count()) === 1, "URL field is aria-invalid with an error message");
await shot(prof, "prof-material-form-error");
await prof.fill(`${matForm} input[name=url]`, "https://example.com/reading");
await shot(prof, "prof-material-form-link");
await prof.click(`${matForm} button[type=submit]`);
await waitSaved(prof);

await prof.click(`${matForm} label:has-text("Upload a file")`);
await prof.fill(`${matForm} input[name=title]`, "Week 1 handout");
await prof.setInputFiles(`${matForm} input[name=file]`, { name: "handout.pdf", mimeType: "application/pdf", buffer: PDF });
await prof.click(`${matForm} button[type=submit]`);
await waitSaved(prof);
await shot(prof, "prof-materials-drafts");

// student can't see drafts yet
const studentCtx = await ctx(".auth/student.json");
const student = await studentCtx.newPage();
await student.goto(`${courseUrl.replace("/professor", "")}`, { waitUntil: "networkidle" });
check((await student.locator("text=Reading list").count()) === 0, "student does not see draft materials");
check(await student.locator("text=View syllabus (PDF)").count() > 0, "student sees the syllabus immediately");

// publish both
for (let i = 0; i < 2; i++) {
  await prof.locator("button:has-text('Publish')").first().click();
  await prof.waitForLoadState("networkidle");
  await prof.waitForTimeout(800);
}
await shot(prof, "prof-materials-published");

// ── Student ────────────────────────────────────────────────────────────────
await student.goto(`${BASE_URL}/courses/${courseId}`, { waitUntil: "networkidle" });
check((await student.locator("iframe").count()) === 0, "student course page has no <iframe>");
await shot(student, "student-course");

// A new tab that navigates to the signed URL. Headless Chromium has no PDF
// viewer, so the navigation may surface as a download instead of a URL; both
// prove the tab was opened and pointed at the file.
const tapOpensTab = async (selector, label) => {
  // Listeners go on BEFORE the click: a download can start before the popup
  // `page` event reaches us, and may be attributed to the opener page.
  let download = null;
  const onDownload = (d) => (download ??= d.suggestedFilename());
  student.on("download", onDownload);
  studentCtx.on("page", (p) => p.on("download", onDownload));
  const [tab] = await Promise.all([studentCtx.waitForEvent("page", { timeout: 20000 }), student.click(selector)]);
  await Promise.race([
    tab.waitForURL((u) => u.protocol.startsWith("http"), { timeout: 8000 }),
    new Promise((resolve) => {
      const t = setInterval(() => download && (clearInterval(t), resolve()), 100);
      setTimeout(() => clearInterval(t) || resolve(), 8000);
    }),
  ]).catch(() => {});
  student.off("download", onDownload);
  const outcome = download ? `download ${download}` : tab.url().startsWith("http") ? `url ${tab.url().slice(0, 50)}…` : null;
  check(outcome !== null, `${label} opened in a new tab (${outcome ?? "tab stayed blank"})`);
  await tab.close().catch(() => {});
};
await tapOpensTab("button:has-text('View syllabus (PDF)')", "syllabus");
await tapOpensTab("button:has-text('Week 1 handout')", "file material");
check(
  (await student.locator("a:has-text('Reading list')").getAttribute("target")) === "_blank",
  "link material is an <a target=_blank>",
);

// professor preview has no iframe either
await prof.goto(courseUrl, { waitUntil: "networkidle" });
check((await prof.locator("iframe").count()) === 0, "professor course page has no <iframe>");

if (process.env.KEEP) {
  console.log(`KEEP=1: left syllabus + materials in place. Course: ${courseUrl}`);
  await browser.close();
  process.exit(failures ? 1 : 0);
}

// ── Cleanup (removes the Storage objects through the real actions) ────────
for (let i = 0; i < 2; i++) {
  await prof.locator("button:has-text('Delete')").first().click();
  await prof.waitForLoadState("networkidle");
  await prof.waitForTimeout(800);
}
await prof.locator("button:has-text('Remove')").first().click();
await prof.waitForLoadState("networkidle");
await prof.waitForTimeout(800);
await shot(prof, "prof-after-cleanup");

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
console.log(`Audit course left in place (no storage objects): ${courseUrl}`);
process.exit(failures ? 1 : 0);
