#!/usr/bin/env node
// End-to-end walk of the Exams screens at phone width with the dev seed
// accounts, against a real Supabase project. All exam wording is an obvious
// PLACEHOLDER; this checks structure, not content.
//
//   BASE_URL=http://localhost:3100 pnpm flow-exams
// Requires .auth/prof.json and .auth/student.json from `pnpm auth-session`.
// Leaves the audit course behind (no storage objects).
//
// Proves: the publish gate lists what's missing and blocks; both languages
// publish; the structure locks once published; the student picks a language,
// answers all four types, autosaves, submits; nothing is auto-graded; the
// professor grades by hand; the student sees the grade only after; no
// horizontal overflow at 375px.
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? ".screenshots/flow-exams";
const STUDENT_EMAIL = process.env.STUDENT_EMAIL ?? "student-1@example.test";
const title = `Audit exams ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

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
  await page.screenshot({ path: path.join(OUT, `${String(step).padStart(2, "0")}-${name}.png`), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `${name}: no horizontal overflow${overflow > 0 ? ` (${overflow}px)` : ""}`);
};
const ctx = async (cookieFile, wide = false) => {
  const c = await browser.newContext(
    wide
      ? { viewport: { width: 1280, height: 800 } }
      : { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  );
  await c.addCookies(JSON.parse(await readFile(cookieFile, "utf8")));
  return c;
};

// ── Professor: course, roster, exam draft ──────────────────────────────────
const prof = await (await ctx(".auth/prof.json")).newPage();
prof.on("dialog", (d) => d.accept());
await prof.goto(`${BASE_URL}/professor/courses/new`, { waitUntil: "networkidle" });
await prof.fill("#title", title);
await prof.click("form:has(#title) button[type=submit]");
await prof.waitForURL(/\/professor\/courses\/[0-9a-f-]{36}$/, { timeout: 30000 });
const courseId = prof.url().split("/").pop();
await prof.waitForLoadState("networkidle");
await prof.fill("form:has(#email) #email", STUDENT_EMAIL);
await prof.click("form:has(#email) button[type=submit]");
await prof.waitForSelector("form:has(#email) button[type=submit]:not([aria-busy=true])", { timeout: 30000 });
await prof.waitForLoadState("networkidle");

const examForm = "form:has(input[name=titleEs])";
await prof.fill(`${examForm} input[name=titleEs]`, "PLACEHOLDER titulo");
await prof.fill(`${examForm} input[name=titleEn]`, "PLACEHOLDER title");
await shot(prof, "prof-course-add-exam");
await prof.click(`${examForm} button[type=submit]`);
await prof.waitForURL(/\/professor\/exams\/[0-9a-f-]{36}$/, { timeout: 30000 });
await prof.waitForLoadState("networkidle");
const examUrl = prof.url();
const examId = examUrl.split("/").pop();
check(true, `created draft exam ${examId}`);

// ── Add one question of each type (the essay misses its English prompt) ────
const addForm = "form:has(select[name=type])";
async function addQuestion(type, fields) {
  await prof.selectOption(`${addForm} select[name=type]`, type);
  for (const [name, value] of Object.entries(fields)) await prof.fill(`${addForm} [name=${name}]`, value);
  await prof.click(`${addForm} button[type=submit]`);
  await prof.waitForSelector(`${addForm} [role=status]:has-text("Question added")`, { timeout: 30000 });
  await prof.reload({ waitUntil: "networkidle" });
}
await addQuestion("multiple_choice", { promptEs: "PLACEHOLDER mc es", promptEn: "PLACEHOLDER mc en", optionsEs: "a\nb\nc", optionsEn: "a\nb\nc" });
await prof.selectOption(`${addForm} select[name=correctOption]`, "1").catch(() => {});
await addQuestion("true_false", { promptEs: "PLACEHOLDER tf es", promptEn: "PLACEHOLDER tf en" });
await addQuestion("fill_in_the_blank", { promptEs: "PLACEHOLDER fill es", promptEn: "PLACEHOLDER fill en", referenceAnswerEs: "PLACEHOLDER KEYGUIDE fill es", referenceAnswerEn: "PLACEHOLDER KEYGUIDE fill en" });
await addQuestion("short_essay", { promptEs: "PLACEHOLDER essay es", referenceAnswerEs: "PLACEHOLDER KEYGUIDE essay es", referenceAnswerEn: "PLACEHOLDER KEYGUIDE essay en" });
await shot(prof, "prof-exam-builder-draft");

// ── Publish gate: refused with a specific list ─────────────────────────────
await prof.click("button:has-text('Publish')");
await prof.waitForSelector("text=Add the English prompt", { timeout: 20000 });
check(true, "publish refused, lists what's missing");
await shot(prof, "prof-publish-refused");

// fix: open question 4 and add the English prompt, set MC + TF keys
const details = prof.locator("details");
await details.nth(0).locator("summary").click();
await details.nth(0).locator("select[name=correctOption]").selectOption("1");
await details.nth(0).locator("button[type=submit]").click();
await details.nth(0).locator("[role=status]:has-text('Saved')").waitFor({ timeout: 20000 });
await details.nth(1).locator("summary").click();
await details.nth(1).locator("select[name=correctOption]").selectOption("0");
await details.nth(1).locator("button[type=submit]").click();
await details.nth(1).locator("[role=status]:has-text('Saved')").waitFor({ timeout: 20000 });
await details.nth(3).locator("summary").click();
await details.nth(3).locator("textarea[name=promptEn]").fill("PLACEHOLDER essay en");
await details.nth(3).locator("button[type=submit]").click();
await details.nth(3).locator("[role=status]:has-text('Saved')").waitFor({ timeout: 20000 });
await prof.click("button:has-text('Publish')");
await prof.waitForSelector("text=Published. Enrolled students", { timeout: 20000 });
await prof.reload({ waitUntil: "networkidle" });
check((await prof.locator("button:has-text('Add question')").count()) === 0, "published exam is read-only (no add-question form)");
await shot(prof, "prof-exam-published");

// ── Student: take the exam in English ──────────────────────────────────────
const student = await (await ctx(".auth/student.json")).newPage();
student.on("dialog", (d) => d.accept());
await student.goto(`${BASE_URL}/courses/${courseId}`, { waitUntil: "networkidle" });
check((await student.locator("text=PLACEHOLDER titulo").count()) + (await student.locator("text=Exams").count()) > 0, "student sees the Exams section once published");
await shot(student, "student-course-exams");
await student.click("a:has-text('PLACEHOLDER')");
await student.waitForURL(/\/exams\/[0-9a-f-]{36}$/, { timeout: 30000 });
await student.waitForLoadState("networkidle");
await shot(student, "student-exam-landing");
await student.click("label:has-text('English')");
await student.click("button:has-text('Start attempt')");
await student.waitForURL(/\/attempt\/[0-9a-f-]{36}$/, { timeout: 30000 });
await student.waitForLoadState("networkidle");
check((await student.locator("text=PLACEHOLDER mc en").count()) === 1, "English prompts shown for an English attempt");
check((await student.locator("text=Verdadero").count()) === 0 && (await student.locator("text=True").count()) > 0, "true/false labels follow the attempt language");
await shot(student, "student-attempt-start");

await student.click("label:has-text('b')");
await student.waitForSelector("text=Saved", { timeout: 20000 });
check(true, "autosave confirmed after choosing an option");
await student.click("fieldset:nth-of-type(1) >> nth=1").catch(() => {});
await student.locator("label:has-text('True')").first().click();
await student.locator("textarea").nth(0).fill("PLACEHOLDER fill answer");
await student.locator("textarea").nth(1).fill("PLACEHOLDER essay answer");
await shot(student, "student-attempt-filled");
// Raw server HTML (includes the RSC payload) of every student exam page must
// never carry a key or grading guide, whatever the markup shows.
const leakScan = async (label, url) => {
  const res = await student.context().request.get(url);
  const html = await res.text();
  const leaked = /KEYGUIDE|correctOption|correct_option|referenceAnswer|reference_answer/.test(html);
  check(res.ok() && !leaked, `${label}: raw HTML has no key or grading guide`);
};
await leakScan("student attempt page", student.url());
await leakScan("student exam landing", `${BASE_URL}/courses/${courseId}/exams/${examId}`);
await leakScan("student course page", `${BASE_URL}/courses/${courseId}`);

// Timer: a role=timer, never an aria-live ticker; threshold text lives in a separate status region.
check((await student.locator("[role=timer]").count()) === 1, "attempt has one role=timer clock");
check((await student.locator("[role=timer][aria-live=assertive], [role=timer][aria-live=polite]").count()) === 0, "the ticking clock is not a live region");
await student.click("button:has-text('Submit answers')");
await student.waitForSelector("text=Submit your answers?", { timeout: 10000 });
check(true, "inline submit confirmation appears (no native dialog)");
await shot(student, "student-submit-confirm");
await student.click("button:has-text('Keep working')");
check((await student.locator("button:has-text('Submit answers')").count()) === 1, "Keep working returns to the form with answers intact");
await student.click("button:has-text('Submit answers')");
await student.click("button:has-text('Yes, submit')");
await student.waitForSelector("text=Submitted. Your professor will grade", { timeout: 30000 });
check(true, "submitted; the attempt says it awaits manual grading (no auto score)");
await shot(student, "student-submitted");

// ── Professor grades by hand ───────────────────────────────────────────────
await prof.goto(`${examUrl}/submissions`, { waitUntil: "networkidle" });
await shot(prof, "prof-submissions");
await prof.click("a:has-text('Attempt 1')");
await prof.waitForURL(/\/submissions\/[0-9a-f-]{36}$/, { timeout: 30000 });
await prof.waitForLoadState("networkidle");
check((await prof.locator("p:has-text('Key:')").count()) >= 2, "professor sees the key beside the student's answer");
check((await prof.locator("text=PLACEHOLDER KEYGUIDE").count()) >= 1, "professor sees the grading guide");
// A bad grade keeps every typed value and shows the error on the field.
await prof.fill("textarea[name^='comment:'] >> nth=0", "PLACEHOLDER keep this comment");
await prof.fill("input[name=grade]", "150");
await prof.fill("textarea[name=feedback]", "PLACEHOLDER keep feedback");
await prof.click("button:has-text('Save grade')");
await prof.waitForSelector("#grade[aria-invalid=true]", { timeout: 20000 });
check((await prof.inputValue("input[name=grade]")) === "150", "grading error keeps the typed grade");
check((await prof.inputValue("textarea[name=feedback]")) === "PLACEHOLDER keep feedback", "grading error keeps the typed feedback");
check((await prof.inputValue("textarea[name^='comment:'] >> nth=0")) === "PLACEHOLDER keep this comment", "grading error keeps the typed per-answer comment");
await shot(prof, "prof-grading-error");
await prof.fill("input[name=grade]", "88");
await prof.fill("textarea[name=feedback]", "PLACEHOLDER feedback");
await shot(prof, "prof-grading");
await prof.click("button:has-text('Save grade')");
await prof.waitForSelector("text=Grade saved.", { timeout: 20000 });

// ── Student sees the grade only now ────────────────────────────────────────
await student.reload({ waitUntil: "networkidle" });
check((await student.locator("text=Grade: 88").count()) > 0, "student sees the grade after the professor saved it");
check((await student.locator("text=Key:").count()) === 0 && (await student.locator("text=Grading guide").count()) === 0, "student never sees a key or grading guide");
await shot(student, "student-graded");

await leakScan("student review page", student.url());

// ── Wide layout: same pages at 1280px, no overflow ─────────────────────────
const wideStudent = await (await ctx(".auth/student.json", true)).newPage();
const wideProf = await (await ctx(".auth/prof.json", true)).newPage();
for (const [pg, name, url] of [
  [wideStudent, "wide-student-course", `${BASE_URL}/courses/${courseId}`],
  [wideStudent, "wide-student-exam", `${BASE_URL}/courses/${courseId}/exams/${examId}`],
  [wideProf, "wide-prof-course", `${BASE_URL}/professor/courses/${courseId}`],
  [wideProf, "wide-prof-submissions", `${examUrl}/submissions`],
]) {
  await pg.goto(url, { waitUntil: "networkidle" });
  await shot(pg, name);
}

await browser.close();
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
