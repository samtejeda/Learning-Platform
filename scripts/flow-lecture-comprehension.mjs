#!/usr/bin/env node
// End-to-end check of the lecture comprehension question UI with the dev seed
// accounts, against a real Supabase project, at phone width (375px) and desktop
// (1280px). All wording is neutral placeholder text ("Question 1 es", "Option A es").
//
//   professor: builds a course with two lectures; on lecture A saves a half-filled
//     question (save blocked, reason shown), a complete one, sees the "ready" checklist,
//     turns it on, adds Question 2, turns it off ("kept") and on again, and is refused
//     (server message) when a save would leave an enabled question incomplete; lecture B
//     gets Question 1 only; the course list shows "Question on/off"; the instructor
//     preview is read-only, key-free and never calls the check route.
//   student: sees nothing before finishing the lecture; after completion (see below)
//     lecture A: wrong -> retry shows Question 2 + attempts left -> language switch ->
//     right -> passed (kept on reload); lecture B: wrong -> Question 1 again -> wrong ->
//     blocked (neutral, no promised unlock). Touch targets, overflow and a key scan.
//
// COMPLETION IS SEEDED: this machine cannot decode H.264 and honest progress takes
// real wall-clock time, so "the student finished the lecture" is written straight into
// lecture_progress (the same row the integration tests write) via DATABASE_URL.
// The in-page router.refresh() when the player first reports completion is therefore
// NOT exercised here; the card is checked after a reload.
//
//   BASE_URL=http://localhost:3100 pnpm flow-lecture-comprehension
// Requires .auth/prof.json and .auth/student.json from `pnpm auth-session`, and
// DATABASE_URL in .env.local. Leaves the audit course behind.
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* env may already be set */
}

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? ".screenshots/flow-lecture-comprehension";
const STUDENT_EMAIL = process.env.STUDENT_EMAIL ?? "student-1@example.test";
const title = `Audit comprehension ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
let step = 0;
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures++;
};
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = async (page, name) => {
  step++;
  await page.screenshot({ path: path.join(OUT, `${String(step).padStart(2, "0")}-${name}.png`), fullPage: true });
  const overflow = await overflowOf(page);
  check(overflow <= 0, `${name}: no horizontal overflow${overflow > 0 ? ` (${overflow}px)` : ""}`);
};
const PHONE = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const WIDE = { viewport: { width: 1280, height: 800 } };
const ctx = async (cookieFile, opts = WIDE) => {
  const c = await browser.newContext(opts);
  await c.addCookies(JSON.parse(await readFile(cookieFile, "utf8")));
  return c;
};
const visible = (loc) => loc.first().isVisible().catch(() => false);
// Lecture pages never reach "networkidle": the synthetic MP4 cannot play, so the player keeps asking for a fresh stream URL.
const openLecture = async (page, url) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
};
const settle = async (page) => {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200); // let the page hydrate before typing into controlled fields
};
/** Every matching element is at least 44px tall. */
async function minHeights(loc, name, min = 44) {
  const hs = await loc.evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().height)));
  check(hs.length > 0 && hs.every((h) => h >= min), `${name}: touch targets >= ${min}px (${hs.length} checked, smallest ${Math.min(...hs)}px)`);
}

const { buildMp4Head } = await import("../lib/video/mp4-fixture.ts");
const MP4 = Buffer.from(buildMp4Head({ seconds: 30 }));

// ── Professor: course, two lectures ─────────────────────────────────────────
const profCtx = await ctx(".auth/prof.json", PHONE);
// Headless Chromium cannot decode H.264; the upload form reads the duration in the browser, so a created <video> reports 30 s.
await profCtx.addInitScript(() => {
  const create = document.createElement.bind(document);
  document.createElement = (tag, ...rest) => {
    const el = create(tag, ...rest);
    if (String(tag).toLowerCase() === "video") {
      Object.defineProperty(el, "duration", { get: () => 30 });
      const setSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src").set;
      Object.defineProperty(el, "src", {
        set(v) {
          setSrc.call(el, v);
          setTimeout(() => el.onloadedmetadata && el.onloadedmetadata(new Event("loadedmetadata")), 20);
        },
        get() {
          return el.getAttribute("src");
        },
      });
    }
    return el;
  };
});
const prof = await profCtx.newPage();
const checkRouteCalls = [];
prof.on("request", (r) => {
  if (r.url().includes("/comprehension") && r.method() === "POST") checkRouteCalls.push(r.url());
});
await prof.goto(`${BASE_URL}/professor/courses/new`, { waitUntil: "networkidle" });
await prof.fill("#title", title);
await prof.click("form:has(#title) button[type=submit]");
await prof.waitForURL(/\/professor\/courses\/[0-9a-f-]{36}$/, { timeout: 30000 });
const courseId = prof.url().split("/").pop();
const courseUrl = prof.url();
await prof.waitForLoadState("networkidle");
await prof.fill("form:has(#email) #email", STUDENT_EMAIL);
await prof.click("form:has(#email) button[type=submit]");
await prof.waitForSelector("form:has(#email) button[type=submit]:not([aria-busy=true])", { timeout: 30000 });
await prof.waitForLoadState("networkidle");

for (const name of ["Lecture A", "Lecture B"]) {
  await prof.goto(courseUrl, { waitUntil: "networkidle" });
  await prof.waitForTimeout(1000);
  await prof.fill("#lectures input[name=title]", name);
  await prof.setInputFiles("#lectures input[type=file]", { name: "clip.mp4", mimeType: "video/mp4", buffer: MP4 });
  await prof.click("#lectures form:has(input[type=file]) button[type=submit]");
  await prof.waitForSelector("text=Video uploaded", { timeout: 90000 });
  await prof.waitForLoadState("networkidle");
}
await prof.goto(courseUrl, { waitUntil: "networkidle" });
await prof.waitForTimeout(1200);
const editHrefs = await prof.locator("#lectures-content li").evaluateAll((lis) =>
  lis.map((li) => [...li.querySelectorAll("a")].find((a) => a.textContent.trim() === "Edit")?.getAttribute("href")),
);
check(editHrefs.length === 2 && editHrefs.every(Boolean), "course page lists the two uploaded lectures with Edit links");
const [editA, editB] = editHrefs;
const lectureA = editA.split("/")[3];
const lectureB = editB.split("/")[3];
check((await prof.locator("#lectures-content li").first().innerText()).includes("Question off"), "lecture rows start with a 'Question off' badge");
await shot(prof, "prof-course-lectures-off");

// ── Professor: author Question 1 on lecture A ───────────────────────────────
const slotFields = async (page, n, { pes, pen, rows, key }) => {
  const slot = page.locator(`#comprehension-q${n}`);
  if (pes !== undefined) await slot.locator('textarea[id$="-prompt-es"]').fill(pes);
  if (pen !== undefined) await slot.locator('textarea[id$="-prompt-en"]').fill(pen);
  for (const [i, [es, en]] of rows.entries()) {
    await slot.locator(`input[id$="-opt-${i}-es"]`).fill(es);
    await slot.locator(`input[id$="-opt-${i}-en"]`).fill(en);
  }
  if (key !== undefined) await slot.locator('label:has-text("Correct answer")').nth(key).click();
};
const save = async (page) => {
  await page.getByRole("button", { name: "Save question" }).click();
};
const abc = [["Option A es", "Option A en"], ["Option B es", "Option B en"], ["Option C es", "Option C en"]];

await prof.goto(`${BASE_URL}${editA}`, { waitUntil: "networkidle" });
await settle(prof);
check(await visible(prof.getByText("Off: students aren't asked")), "edit page: status says the question is off");
check(await visible(prof.getByText("Add the first question.")), "edit page: checklist names what is missing (first question)");
const turnOn = prof.getByRole("button", { name: "Turn on", exact: true });
check(await turnOn.isDisabled(), "edit page: Turn on is disabled while the checklist has items");
check(await visible(prof.getByText("Fix the items above, save, then turn it on.")), "edit page: the reason sits beside the disabled button");
await shot(prof, "prof-edit-empty-phone");

// A half-filled option blocks the save and says why
await prof.locator('#comprehension-q1 input[id$="-opt-0-es"]').fill("Option A es");
check(await prof.getByRole("button", { name: "Save question" }).isDisabled(), "a half-filled option disables Save");
check(await visible(prof.getByText("Question 1: fill in option 1 in both languages, or remove it.")), "...and the reason is written beside it");
await shot(prof, "prof-edit-save-blocked");

await slotFields(prof, 1, { pes: "Question 1 es", pen: "Question 1 en", rows: abc, key: 1 });
check(!(await prof.getByRole("button", { name: "Save question" }).isDisabled()), "a complete question enables Save");
check(await visible(prof.getByText("You have unsaved changes. Save them first", { exact: false })) || (await turnOn.isDisabled()), "Turn on stays off while the form has unsaved edits");
await save(prof);
await prof.waitForSelector("text=Comprehension question saved.", { timeout: 30000 });
await prof.waitForSelector("text=The saved question is complete in Spanish and English.", { timeout: 30000 });
check(
  (await prof.locator('#comprehension-q1 label:has-text("Correct answer") input').nth(1).isChecked()) &&
    (await prof.locator('#comprehension-q1 input[id$="-opt-0-es"]').inputValue()) === "Option A es",
  "after saving, the form keeps what was typed and the marked correct answer",
);
check(true, "after saving, the checklist reads 'complete in Spanish and English'");
check(!(await turnOn.isDisabled()), "Turn on is enabled once the saved question is complete");
await shot(prof, "prof-edit-ready-phone");

await turnOn.click();
await prof.waitForSelector("text=On: students are asked", { timeout: 30000 });
check(true, "Turn on switches the status to 'On'");

// Question 2 (optional), saved while on
await slotFields(prof, 2, { pes: "Question 2 es", pen: "Question 2 en", rows: abc, key: 2 });
await save(prof);
await prof.waitForSelector("text=Comprehension question saved.", { timeout: 30000 });
const preview = prof.locator("section[aria-label='What the student sees']");
check((await preview.innerText()).includes("Question 1 es") && (await preview.innerText()).includes("Question 2 es"), "live preview shows both questions (Español by default)");
await preview.locator("label:has-text('English')").click();
check((await preview.innerText()).includes("Question 2 en") && !(await preview.innerText()).includes("Question 2 es"), "preview switches one language at a time");
check((await preview.locator("input[type=radio][name*='-lang']").count()) === 2 && (await preview.locator("input:not([name*='-lang']), button").count()) === 0, "preview adds no controls besides its language switch");

// Server refuses a save that would leave an enabled question incomplete
await prof.locator('#comprehension-q1 textarea[id$="-prompt-es"]').fill("");
await save(prof);
await prof.waitForSelector("text=isn't complete", { timeout: 30000 });
const refusal = await prof.locator("[role=alert]").first().innerText();
check(/Question 1: Add the Spanish question\./.test(refusal), `enabled + incomplete save is refused in plain words ("${refusal.slice(0, 80)}…")`);
await shot(prof, "prof-edit-refused");
await prof.locator('#comprehension-q1 textarea[id$="-prompt-es"]').fill("Question 1 es");
await save(prof);
await prof.waitForSelector("text=Comprehension question saved.", { timeout: 30000 });

// Turn off keeps the question
await prof.getByRole("button", { name: "Turn off", exact: true }).click();
check(await visible(prof.getByText("Your written question is kept", { exact: false })), "Turn off asks first and says the written question is kept");
await shot(prof, "prof-edit-turn-off-confirm");
await prof.getByRole("button", { name: "Yes, turn it off" }).click();
await prof.waitForSelector("text=Off: students aren't asked", { timeout: 30000 });
await prof.reload({ waitUntil: "networkidle" });
await settle(prof);
check((await prof.locator('#comprehension-q1 textarea[id$="-prompt-es"]').inputValue()) === "Question 1 es", "after turning off and reloading, the written question is still there");
await prof.getByRole("button", { name: "Turn on", exact: true }).click();
await prof.waitForSelector("text=On: students are asked", { timeout: 30000 });
await minHeights(
  prof.locator("main button:not(.max-w-xl *), main label:has(input[type=radio]):not(.max-w-xl *), #comprehension-q1 input[type=text], #comprehension-q1 textarea"),
  "professor edit page (phone)",
);

// ── Lecture B: Question 1 only; the "off" preview first ─────────────────────
await openLecture(prof, `${BASE_URL}/courses/${courseId}/lectures/${lectureB}`);
check(await visible(prof.getByText("The quick check question is off for this lecture", { exact: false })), "instructor preview: a one-line note when the question is off");
await prof.goto(`${BASE_URL}${editB}`, { waitUntil: "networkidle" });
await settle(prof);
await slotFields(prof, 1, { pes: "Question 1 es", pen: "Question 1 en", rows: abc, key: 0 });
await save(prof);
await prof.waitForSelector("text=Comprehension question saved.", { timeout: 30000 });
await prof.waitForSelector("text=The saved question is complete in Spanish and English.", { timeout: 30000 });
await prof.getByRole("button", { name: "Turn on", exact: true }).click();
await prof.waitForSelector("text=On: students are asked", { timeout: 30000 });

// course list badges, then publish both
await prof.goto(courseUrl, { waitUntil: "networkidle" });
await prof.waitForTimeout(1200);
const rowTexts = await prof.locator("#lectures-content li").allInnerTexts();
check(rowTexts.length === 2 && rowTexts.every((t) => t.includes("Question on")), "course list shows 'Question on' on both lectures");
for (const k of [1, 2]) {
  await prof.locator("#lectures-content").getByRole("button", { name: "Publish", exact: true }).first().click();
  await prof.waitForSelector(`#lectures-heading button:has-text('${k} of 2 published')`, { timeout: 30000 });
  await prof.reload({ waitUntil: "networkidle" });
  await prof.waitForTimeout(1200);
}
await shot(prof, "prof-course-lectures-on");

// instructor preview of lecture A (question on): read-only, no key, no check route
await openLecture(prof, `${BASE_URL}/courses/${courseId}/lectures/${lectureA}`);
const ip = prof.locator("section[aria-label='Quick check (instructor preview)']");
check(await visible(ip), "instructor preview shows the question read-only");
check((await ip.getByRole("button").count()) === 0 && (await ip.locator("input:not([name*='-lang'])").count()) === 0, "instructor preview has no answer controls and no check button");
const html = await prof.content();
check(!/correctOption|correct_option/.test(html), "instructor preview HTML carries no answer key");
await shot(prof, "prof-preview-phone");
check(checkRouteCalls.length === 0, "the check route was never called by the professor");

// ── Student ─────────────────────────────────────────────────────────────────
const studentCtx = await ctx(".auth/student.json", PHONE);
const student = await studentCtx.newPage();
const responses = [];
student.on("response", async (r) => {
  if (r.url().includes("/comprehension") && r.request().method() === "POST") responses.push({ status: r.status(), body: await r.text().catch(() => "") });
});
/** Wait for card text; on a miss print what the card and the route actually said, then fail. */
const cardSays = async (text, timeout = 30000) => {
  try {
    await student.waitForSelector(`text=${text}`, { timeout });
  } catch (e) {
    console.log("card text was:", (await region().innerText().catch(() => "(no card)")).replace(/\s+/g, " "));
    console.log("check route responses:", JSON.stringify(responses.map((r) => [r.status, r.body.slice(0, 160)])));
    throw e;
  }
};
const lectureUrl = (id) => `${BASE_URL}/courses/${courseId}/lectures/${id}`;
const region = () => student.getByRole("region", { name: "Quick check" });

await openLecture(student, lectureUrl(lectureA));
check((await region().count()) === 0, "student: no question card before the lecture is finished");

const [{ id: studentId }] = await sql`select id from public.users where email = ${STUDENT_EMAIL}`;
for (const id of [lectureA, lectureB]) {
  await sql`insert into lecture_progress (student_id, lecture_id, completed, completed_at, watched_seconds)
            values (${studentId}, ${id}, true, now(), 30) on conflict do nothing`;
}

// lecture A: Question 1 (wrong) -> Question 2 (right)
await openLecture(student, lectureUrl(lectureA));
await student.waitForTimeout(1200);
check(await visible(region()), "student: the card appears once the lecture is finished");
check((await region().innerText()).includes("Question 1 es"), "student: Español is the default and Question 1 is asked first");
check(!/correctOption|correct_option/.test(await student.content()), "student page HTML carries no answer key");
await minHeights(region().locator("fieldset label"), "student card options + language switch (phone)");
await minHeights(region().getByRole("button", { name: "Check answer" }), "Check answer button (phone)");
await shot(student, "student-card-open-phone");

await region().getByRole("button", { name: "Check answer" }).click();
check(await visible(student.getByText("Choose an answer first.")), "student: pressing Check with nothing chosen asks for an answer");
await region().locator("form input[type=radio]").nth(0).check(); // wrong (key is option B)
await region().getByRole("button", { name: "Check answer" }).click();
await cardSays("Not quite.");
check((await region().innerText()).includes("You have 1 attempt left."), "student: wrong answer says how many attempts are left");
check(!(await region().getByRole("button", { name: "Check answer" }).isDisabled()), "student: Check answer is enabled again once the answer has been checked");
check((await region().innerText()).includes("Question 2 es"), "student: the retry asks Question 2 (the professor wrote one)");
check((await region().locator("form input[type=radio]:checked").count()) === 0, "student: nothing is pre-selected on the retry");
await shot(student, "student-card-retry-phone");
await region().locator("label:has-text('English')").click();
check((await region().innerText()).includes("Question 2 en"), "student: the language switch changes the wording");
await region().locator("form input[type=radio]").nth(2).check(); // right (key is option C)
await region().getByRole("button", { name: "Check answer" }).click();
await cardSays("That's right.");
check((await region().getByRole("button", { name: "Check answer" }).count()) === 0, "student: after a right answer the form is gone");
await shot(student, "student-card-passed-phone");
await student.reload({ waitUntil: "domcontentloaded" });
await student.waitForTimeout(2500);
check((await region().innerText()).includes("You answered this question correctly."), "student: passed state persists after a reload");

// lecture B: Question 1 (wrong) -> Question 1 again (wrong) -> blocked
await openLecture(student, lectureUrl(lectureB));
await student.waitForTimeout(1200);
await region().locator("form input[type=radio]").nth(1).check(); // wrong (key is option A)
await region().getByRole("button", { name: "Check answer" }).click();
await cardSays("Not quite.");
check((await region().innerText()).includes("Question 1 es"), "student: with no Question 2, the retry asks Question 1 again");
await region().locator("form input[type=radio]").nth(2).check(); // wrong again
await region().getByRole("button", { name: "Check answer" }).click();
await cardSays("used both attempts");
const blocked = await region().innerText();
check(!/unlock|teacher|professor|contact|locked/i.test(blocked), `student: blocked message is neutral, no promised unlock ("${blocked.replace(/\s+/g, " ").slice(-90)}")`);
check((await region().locator("form input[type=radio]").count()) === 0 && (await region().getByRole("button", { name: "Check answer" }).count()) === 0, "student: blocked shows no answer controls");
await shot(student, "student-card-blocked-phone");
await student.reload({ waitUntil: "domcontentloaded" });
await student.waitForTimeout(2500);
check((await region().innerText()).includes("You've used both attempts on this question."), "student: blocked state persists after a reload");

// the route's own JSON: no key, only the documented fields
const allowed = new Set(["correct", "status", "attemptsRemaining", "nextQuestion", "es", "en", "prompt", "options"]);
const keysOf = (v, out = new Set()) => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.add(k), keysOf(x, out));
  return out;
};
const bodies = responses.filter((r) => r.status === 200).map((r) => JSON.parse(r.body));
check(bodies.length === 4 && bodies.every((b) => [...keysOf(b)].every((k) => allowed.has(k))), `check route responses carry only documented fields (${bodies.length} responses)`);

// ── Desktop ─────────────────────────────────────────────────────────────────
const sw = await (await ctx(".auth/student.json", WIDE)).newPage();
await openLecture(sw, lectureUrl(lectureB));
await shot(sw, "student-card-desktop");
const pw = await (await ctx(".auth/prof.json", WIDE)).newPage();
await pw.goto(`${BASE_URL}${editA}`, { waitUntil: "networkidle" });
await shot(pw, "prof-edit-desktop");
await openLecture(pw, lectureUrl(lectureA));
await shot(pw, "prof-preview-desktop");

await sql.end();
await browser.close();
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
