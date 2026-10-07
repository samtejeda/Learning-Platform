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

// ── Guided builder: add one question of each type ─────────────────────────
// Drives real controls: the type picker, option rows with a "correct answer"
// radio, two big true/false buttons, blank chips placed by a button, points,
// notes, the live preview and the checklist.
const add = prof.locator("div:has(> h2:text-is('Add a question'))");
const lang = (name) => add.locator(`section[aria-label='${name}']`);
const pickType = async (label) => {
  await add.locator(`fieldset:has(legend:text-is('What kind of question is this?')) label:has-text('${label}')`).click();
};
let added = 0;
const saveAdd = async () => {
  added++;
  await add.locator("button:has-text('Add question')").click();
  await prof.waitForSelector(`text=/^${added} questions?$/`, { timeout: 30000 }).catch(async (e) => {
    console.log("alerts:", await prof.locator("[role=alert], [role=status]").allInnerTexts());
    console.log("disabled:", await add.locator("button:has-text('Add question')").isDisabled(), "reasons:", await add.locator("text=Before you can save").count());
    await prof.screenshot({ path: path.join(OUT, "debug-add.png"), fullPage: true });
    throw e;
  });
  await prof.waitForLoadState("networkidle");
};

check((await add.locator("section[aria-label='Español']").count()) === 0, "a new question shows only the type picker until a type is chosen");
check((await add.locator("input[type=radio]").count()) === 4, "four types, each a labelled radio");
check((await add.locator("text=Students pick one answer. Scored automatically.").count()) === 1, "each type has a one-line plain description");
await shot(prof, "prof-add-question-picker");

// 1. Multiple choice: can't be saved without a correct answer, and says why.
await pickType("Multiple choice");
await lang("Español").locator("textarea").first().fill("PLACEHOLDER mc es");
await lang("English").locator("textarea").first().fill("PLACEHOLDER mc en");
const optionInputs = () => add.locator("fieldset:has(legend:text-is('Options')) input:not([type=radio])");
check((await optionInputs().count()) === 4, "multiple choice starts with two option rows (Español + English each)");
check(await add.locator("button:has-text('Remove'):disabled").first().isVisible(), "options can't drop below two (Remove is off)");
await optionInputs().nth(0).fill("a");
await optionInputs().nth(1).fill("a");
await optionInputs().nth(2).fill("b");
await optionInputs().nth(3).fill("b");
await add.locator("button:has-text('Add option')").click();
await optionInputs().nth(4).fill("c");
check((await add.locator("button:has-text('Add question')").isDisabled()) && (await add.locator("text=Fill in option 3 in both languages, or remove it.").count()) === 1, "an empty option blocks saving and says which one");
await optionInputs().nth(5).fill("c");
check((await add.locator("text=Choose the correct answer.").count()) === 1 && (await add.locator("button:has-text('Add question')").isDisabled()), "no correct answer: Add question is off and the reason is shown");
await shot(prof, "prof-mc-no-key");
await add.locator("label:has-text('Correct answer')").nth(1).click();
check(await add.locator("button:has-text('Add question')").isEnabled(), "choosing the correct answer enables saving");
const preview = add.locator("section[aria-label='Preview of what the student sees']");
check((await preview.locator("text=PLACEHOLDER mc en").count()) === 1, "preview shows the English version first");
await preview.locator("label:has-text('Español')").click();
check((await preview.locator("text=PLACEHOLDER mc es").count()) === 1, "preview switches to Español");
await shot(prof, "prof-mc-ready");
await saveAdd();

// 2. True / false: two big buttons, nothing selected by default.
await pickType("True / false");
check((await add.locator("fieldset:has(legend:text-is('Which answer is correct?')) input:checked").count()) === 0, "true/false has no default answer");
await lang("Español").locator("textarea").first().fill("PLACEHOLDER tf es");
await lang("English").locator("textarea").first().fill("PLACEHOLDER tf en");
check((await add.locator("button:has-text('Add question')").isDisabled()) && (await add.locator("text=Choose whether the correct answer is true or false.").count()) >= 1, "true/false can't be saved until one is chosen");
await add.locator("fieldset:has(legend:text-is('Which answer is correct?')) label:has-text('True')").click();
await saveAdd();

// 3. Fill in the blank: a blank chip placed at the cursor, counts, mismatch warning.
await pickType("Fill in the blank");
await lang("Español").locator("textarea").first().fill("PLACEHOLDER fill es ");
await lang("Español").locator("button:has-text('Insert blank')").click();
check((await lang("Español").locator("text=Blank 1").count()) >= 1 && (await lang("Español").locator("text=1 blank").count()) === 1, "Insert blank places a chip and counts it");
await lang("English").locator("textarea").first().fill("PLACEHOLDER fill en ");
check((await add.locator("text=The Spanish text has 1 blank and the English text has 0 blanks.").count()) === 1, "warns when Español and English have different numbers of blanks");
await lang("English").locator("button:has-text('Insert blank')").click();
check((await add.locator("text=The Spanish text has").count()) === 0, "the warning clears once both match");
await lang("English").locator("button:has-text('Insert blank')").click();
check((await lang("English").locator("text=2 blanks").count()) === 1, "a second blank is counted");
await lang("English").locator("button[aria-label^='Remove blank 2']").click();
check((await lang("English").locator("text=1 blank").count()) === 1, "a blank can be removed again");
check((await add.locator("text={{blank}}").count()) === 0, "the professor never sees the stored markup");
await add.locator("input[name=points]").fill("3");
await add.locator("textarea[id$='-es-notes']").fill("PLACEHOLDER KEYGUIDE fill es");
await add.locator("textarea[id$='-en-notes']").fill("PLACEHOLDER KEYGUIDE fill en");
check((await add.locator("text=Only you see this; students never do.").count()) === 1, "grading notes are labelled as for the professor only");
await shot(prof, "prof-fill-blank");
await saveAdd();

// 4. Essay: the English prompt is left out on purpose so the checklist has something to name.
await pickType("Essay");
await lang("Español").locator("textarea").first().fill("PLACEHOLDER essay es");
await add.locator("input[name=points]").fill("4");
await add.locator("textarea[id$='-es-notes']").fill("PLACEHOLDER KEYGUIDE essay es");
await add.locator("textarea[id$='-en-notes']").fill("PLACEHOLDER KEYGUIDE essay en");
await saveAdd();
check((await prof.locator("p:has-text('Exam total:'):has-text('9 points')").count()) === 1, "exam total shows 9 points (2 automatic, 7 by hand)");
await shot(prof, "prof-exam-builder-draft");

// ── Ready to publish: names what's missing, with a link to it ─────────────
check(await prof.locator("button:has-text('Publish and show to students')").isDisabled(), "Publish is off while something is missing");
check((await prof.locator("text=Fix the items above to publish.").count()) === 1, "and says why");
check((await prof.locator("a:has-text('Question 4')").count()) === 1 && (await prof.locator("text=Add the English prompt.").count()) === 1, "the checklist names question 4 and what it needs");
await shot(prof, "prof-checklist-missing");
await prof.click("a:has-text('Question 4')");
await prof.waitForSelector("#question-4 [id^='editor-']", { timeout: 10000 });
check(true, "the checklist link opens the question to fix");
const q4 = prof.locator("#question-4");
await q4.locator("section[aria-label='English'] textarea").first().fill("PLACEHOLDER essay en");
await q4.locator("button:has-text('Save question')").click();
await prof.waitForSelector("text=Everything is filled in, in both languages.", { timeout: 30000 });
check(true, "after saving, the checklist turns ready");
await shot(prof, "prof-question-edit-open");
await prof.click("button:has-text('Publish and show to students')");
await prof.waitForSelector("text=Publish this exam?", { timeout: 10000 });
check(true, "publish states what will happen and asks first");
await shot(prof, "prof-publish-confirm");
await prof.click("button:has-text('Yes, publish')");
await prof.waitForSelector("text=Live: students can take it", { timeout: 30000 });
await prof.waitForLoadState("networkidle");
check((await add.locator("legend:text-is('What kind of question is this?')").count()) === 1, "published exam with no attempts stays editable (the add-a-question picker is still there)");
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
// Hard-reload first: a server-rendered form also posts React's hidden $ACTION_* fields.
await student.reload({ waitUntil: "networkidle" });
await student.waitForTimeout(1500);
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
await student.locator("input[aria-label*='blank 1']").fill("PLACEHOLDER fill answer");
await student.locator("textarea").nth(0).fill("PLACEHOLDER essay answer");
check((await student.locator("input[aria-label*='blank']").count()) === 1, "fill in the blank shows one input per blank");
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
await student.waitForSelector("text=auto-graded", { timeout: 30000 });
check((await student.locator("#result-title:focus").count()) === 1, "the result heading takes focus so screen readers announce it");
check((await student.locator("text=Pending: not final yet").count()) === 1, "status says pending, not final");
check((await student.locator("p:has-text('2 of 2 auto-graded points, 7 points more pending manual grading')").count()) === 1, "right after submit: '2 of 2 auto-graded points, 7 points more pending manual grading'");
const waiting = student.locator("p:has-text('Waiting on your professor')");
check((await waiting.locator("text=question 3").count()) === 1 && (await waiting.locator("text=question 4").count()) === 1, "the manual questions awaiting grading are named");
check((await student.locator("ol > li p:text-is('Correct')").count()) + (await student.locator("ol > li p:has(span:text-is('Correct'))").count()) === 2, "right/wrong shown per auto-scored question as a word");
check((await student.locator("ol > li p:has(svg):has(span:text-is('Correct'))").count()) === 2, "...and with an icon, so colour is never the only signal");
check((await student.locator("text=Waiting for your professor").count()) === 2, "blank and essay show 'Waiting for your professor'");
check((await student.locator("text=You've used 1 of 2 attempts.").count()) === 1 && (await student.locator("a:has-text('Go to the exam page to try again')").count()) === 1, "attempts left are shown with a way to try again");
check((await student.locator("text=Correct answer:").count()) === 0, "no correct answer revealed by default");
check((await student.locator("text={{blank}}").count()) === 0, "no stored markup on the result screen");
await shot(student, "student-submitted");
await leakScan("student result page (pending)", student.url());

// ── Professor edits a started exam: warned before anything re-scores ───────
await prof.goto(examUrl, { waitUntil: "networkidle" });
check((await prof.locator("text=1 attempt has been started.").count()) >= 1, "the builder says students have started it");
check((await prof.locator("button:has-text('Delete exam')").count()) === 0, "the exam can't be deleted once started, and says so");
check((await add.locator("legend:text-is('What kind of question is this?')").count()) === 0 && (await prof.locator("text=questions can't be added").count()) >= 1, "adding a question is switched off with the reason");
await prof.locator("#question-1 button[aria-expanded]").click();
const q1 = prof.locator("#question-1");
check(await q1.locator("button:has-text('Add option')").isDisabled(), "adding an option is off once students have started");
check((await q1.locator("text=the number of options can't change").count()) >= 1, "...with the plain reason");
await q1.locator("label:has-text('Correct answer')").first().click();
await q1.locator("button:has-text('Save question')").click();
await prof.waitForSelector("text=Save and re-score existing attempts?", { timeout: 10000 });
check(true, "changing the correct answer asks first and says every score updates");
await shot(prof, "prof-edit-rescore-confirm");
await q1.locator("button:has-text('Keep editing')").click();
check((await prof.locator("text=Save and re-score existing attempts?").count()) === 0, "Keep editing backs out without saving");

// ── Professor grades by hand ───────────────────────────────────────────────
await prof.goto(`${examUrl}/submissions`, { waitUntil: "networkidle" });
await shot(prof, "prof-submissions");
await prof.click("a:has-text('Attempt 1')");
await prof.waitForURL(/\/submissions\/[0-9a-f-]{36}$/, { timeout: 30000 });
await prof.waitForLoadState("networkidle");
check((await prof.locator("p:has-text('Key:')").count()) >= 2, "professor sees the key beside the student's answer");
check((await prof.locator("text=PLACEHOLDER KEYGUIDE").count()) >= 1, "professor sees the grading guide");
// Points are checked beside the box (max shown); typed values stay.
check((await prof.locator("text=of 3").count()) >= 1 && (await prof.locator("text=of 4").count()) >= 1, "each manual question shows its maximum");
check(await prof.locator("button:has-text('Save grading')").isDisabled(), "Save grading is off until every manual question has points");
await prof.fill("textarea[name^='comment:'] >> nth=0", "PLACEHOLDER keep this comment");
await prof.fill("input[name^='points:'] >> nth=0", "9");
await prof.fill("input[name^='points:'] >> nth=1", "1");
await prof.fill("textarea[name=feedback]", "PLACEHOLDER keep feedback");
await prof.locator("input[name^='points:'] >> nth=0").blur();
check((await prof.locator("text=Points can't be more than 3.").count()) === 1 && (await prof.locator("input[name^='points:'][aria-invalid=true]").count()) === 1, "too many points: error beside the box, field marked invalid");
check(await prof.locator("button:has-text('Save grading')").isDisabled(), "and Save grading stays off");
check((await prof.inputValue("textarea[name=feedback]")) === "PLACEHOLDER keep feedback" && (await prof.inputValue("textarea[name^='comment:'] >> nth=0")) === "PLACEHOLDER keep this comment", "nothing typed is lost");
await shot(prof, "prof-grading-error");
await prof.fill("input[name^='points:'] >> nth=0", "3");
await prof.fill("input[name^='points:'] >> nth=1", "2.5");
check((await prof.locator("text=7.5 of 9 points").count()) === 1 && (await prof.locator("text=Final once saved").count()) === 1, "running total updates live (2 automatic + 5.5 = 7.5 of 9, final once saved)");
await prof.fill("textarea[name=feedback]", "PLACEHOLDER feedback");
await shot(prof, "prof-grading");
await prof.click("button:has-text('Save grading')");
await prof.waitForSelector("text=Grade saved.", { timeout: 20000 });
await prof.waitForLoadState("networkidle");

// ── Student sees the grade only now ────────────────────────────────────────
await student.reload({ waitUntil: "networkidle" });
check((await student.locator("text=7.5 of 9 points").count()) > 0 && (await student.locator("span:has-text('Final')").count()) >= 1, "student sees the final score (2 auto + 5.5 manual of 9) marked Final after the professor saved it");
check((await student.locator("text=Key:").count()) === 0 && (await student.locator("text=Grading guide").count()) === 0, "student never sees a key or grading guide");
await shot(student, "student-graded");

await leakScan("student review page", student.url());
console.log(`\nPaths for tab-order / screenshots:\n  /courses/${courseId}\n  /courses/${courseId}/exams/${examId}\n  ${new URL(student.url()).pathname}\n  /professor/courses/${courseId}\n  ${new URL(examUrl).pathname}/submissions\n  ${new URL(prof.url()).pathname}`);

// ── Wide layout: same pages at 1280px, no overflow ─────────────────────────
const wideStudent = await (await ctx(".auth/student.json", true)).newPage();
const wideProf = await (await ctx(".auth/prof.json", true)).newPage();
for (const [pg, name, url] of [
  [wideStudent, "wide-student-course", `${BASE_URL}/courses/${courseId}`],
  [wideStudent, "wide-student-exam", `${BASE_URL}/courses/${courseId}/exams/${examId}`],
  [wideProf, "wide-prof-course", `${BASE_URL}/professor/courses/${courseId}`],
  [wideProf, "wide-prof-builder", examUrl],
  [wideProf, "wide-prof-submissions", `${examUrl}/submissions`],
]) {
  await pg.goto(url, { waitUntil: "networkidle" });
  await shot(pg, name);
}

await browser.close();
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
