#!/usr/bin/env node
// End-to-end walk of the Core CRUD screens with the dev seed accounts, at
// phone width, saving a screenshot at each step. Used for the frontend audit
// ("does every screen look correct at 375px?") on signed-in pages.
//
//   BASE_URL=http://localhost:3100 pnpm flow-core-crud
// Requires .auth/prof.json and .auth/student.json from `pnpm auth-session`.
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? ".screenshots/flow";
const STUDENT_EMAIL = process.env.STUDENT_EMAIL ?? "student-1@example.test";
const title = `Audit course ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
let step = 0;
const shot = async (page, name) => {
  step++;
  const file = path.join(OUT, `${String(step).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  console.log(`${file}${overflow > 0 ? `  ⚠ overflow ${overflow}px` : ""}`);
};
const ctx = async (cookieFile) => {
  const c = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addCookies(JSON.parse(await readFile(cookieFile, "utf8")));
  return c;
};
// Submit the invite form and wait for the server action to finish (the
// SubmitButton is aria-busy while pending; React resets the form afterwards,
// so filling before this settles would be wiped).
const submitInvite = async (page) => {
  await page.click("form:has(#email) button[type=submit]");
  await page
    .waitForSelector("form:has(#email) button[type=submit][aria-busy=true]", { timeout: 5000 })
    .catch(() => {});
  await page.waitForSelector("form:has(#email) button[type=submit]:not([aria-busy=true])", {
    timeout: 30000,
  });
  await page.waitForLoadState("networkidle");
};

// ── Professor ──────────────────────────────────────────────────────────────
const prof = await (await ctx(".auth/prof.json")).newPage();
await prof.goto(`${BASE_URL}/professor/courses/new`, { waitUntil: "networkidle" });
await prof.fill("#title", title);
await prof.fill("#description", "A short course used to check the professor and student screens at phone width.\n\nSecond paragraph to see wrapping.");
await shot(prof, "prof-new-course-filled");
await prof.click("form:has(#title) button[type=submit]");
await prof.waitForURL(/\/professor\/courses\/[0-9a-f-]{36}$/, { timeout: 30000 });
const courseUrl = prof.url();
console.log("created", courseUrl);
await prof.waitForLoadState("networkidle");
await shot(prof, "prof-course-empty");

// invite the student
await prof.fill("#email", STUDENT_EMAIL);
await submitInvite(prof);
await shot(prof, "prof-course-after-invite");

// invite an unknown email → "invited" state
await prof.fill("#email", "nobody-yet@example.test");
await submitInvite(prof);
await shot(prof, "prof-course-with-pending-invite");

// validation failure keeps input
await prof.fill("#email", "not-an-email");
await submitInvite(prof);
await prof.waitForSelector("#email-error", { timeout: 10000 });
const kept = await prof.inputValue("#email");
console.log(kept === "not-an-email" ? "✓ invalid email retained" : `✗ email not retained (got "${kept}")`);
await shot(prof, "prof-invite-validation-error");

// edit page
await prof.goto(`${courseUrl}/edit`, { waitUntil: "networkidle" });
await shot(prof, "prof-edit-course");

// open the phone nav sheet
await prof.goto(`${BASE_URL}/professor`, { waitUntil: "networkidle" });
await shot(prof, "prof-dashboard");
await prof.click("button[aria-label='Open menu']");
await prof.waitForSelector("dialog[open]");
await shot(prof, "prof-nav-sheet-open");

// ── Student ────────────────────────────────────────────────────────────────
const student = await (await ctx(".auth/student.json")).newPage();
await student.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
await shot(student, "student-dashboard");
const courseId = courseUrl.split("/").pop();
await student.goto(`${BASE_URL}/courses/${courseId}`, { waitUntil: "networkidle" });
await shot(student, "student-course");
// a course the student is NOT enrolled in → 404 inside the shell
await student.goto(`${BASE_URL}/courses/00000000-0000-4000-8000-000000000000`, { waitUntil: "networkidle" });
await shot(student, "student-course-404");

await browser.close();
console.log(`\nCourse "${title}" left in place for manual inspection: ${courseUrl}`);
