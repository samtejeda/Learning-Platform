#!/usr/bin/env node
// End-to-end check of the course navigation pass with the dev seed accounts,
// against a real Supabase project. It builds a course with all four content
// sections through the real UI (a synthetic MP4 lecture, a PDF syllabus,
// a link material, a published exam), then checks, for a PROFESSOR and a
// STUDENT, at phone width (375px) and desktop (1280px):
//
//   - section order is Syllabus, Lectures, Course materials, Exams (+ Students for the professor)
//   - phones: sticky chips jump to their section and highlight it (aria-current),
//     no sidebar, no breadcrumb, the Back link stays, no sideways overflow
//   - desktop: left sidebar (same order), no chips, breadcrumb replaces the Back link
//   - collapse / expand, remembered per course after a reload, and form state
//     survives a collapse; it still works with storage blocked
//   - exam pages are a centred reading column on desktop
//
//   BASE_URL=http://localhost:3100 pnpm flow-course-nav
// Requires .auth/prof.json and .auth/student.json from `pnpm auth-session`.
// Leaves the audit course behind (its lecture video stays in Storage).
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? ".screenshots/flow-course-nav";
const STUDENT_EMAIL = process.env.STUDENT_EMAIL ?? "student-1@example.test";
const title = `Audit course nav ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
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
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = async (page, name) => {
  step++;
  await page.screenshot({ path: path.join(OUT, `${String(step).padStart(2, "0")}-${name}.png`), fullPage: true });
  const overflow = await overflowOf(page);
  check(overflow <= 0, `${name}: no horizontal overflow${overflow > 0 ? ` (${overflow}px)` : ""}`);
};
const PHONE = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const WIDE = { viewport: { width: 1280, height: 800 } };
const ctx = async (cookieFile, opts = WIDE, extra = {}) => {
  const c = await browser.newContext({ ...opts, ...extra });
  await c.addCookies(JSON.parse(await readFile(cookieFile, "utf8")));
  return c;
};
const visible = (loc) => loc.first().isVisible().catch(() => false);

// ── A synthetic MP4 head (the repo's own test fixture): the upload form accepts MP4 only and checks the
// container header, and this machine has no H.264 encoder. It is not playable; nothing here needs it to be.
const { buildMp4Head } = await import("../lib/video/mp4-fixture.ts");
const MP4 = Buffer.from(buildMp4Head({ seconds: 30 }));

// ── Professor builds the course through the real UI ─────────────────────────
const profCtx = await ctx(".auth/prof.json", PHONE);
// The upload form reads the duration from the file in the browser, and headless Chromium cannot decode H.264, so
// for this setup only, a created <video> reports 30 s once it is given a source.
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
await prof.goto(`${BASE_URL}/professor/courses/new`, { waitUntil: "networkidle" });
await prof.fill("#title", title);
await prof.click("form:has(#title) button[type=submit]");
await prof.waitForURL(/\/professor\/courses\/[0-9a-f-]{36}$/, { timeout: 30000 });
const courseId = prof.url().split("/").pop();
const courseUrl = prof.url();
await prof.waitForLoadState("networkidle");
await prof.fill("#students form:has(#email) #email, form:has(#email) #email", STUDENT_EMAIL);
await prof.click("form:has(#email) button[type=submit]");
await prof.waitForSelector("form:has(#email) button[type=submit]:not([aria-busy=true])", { timeout: 30000 });
await prof.waitForLoadState("networkidle");

// syllabus
await prof.setInputFiles("#syllabus input[type=file]", { name: "syllabus.pdf", mimeType: "application/pdf", buffer: PDF });
await prof.click("#syllabus button[type=submit]");
await prof.waitForSelector("text=Syllabus uploaded.", { timeout: 45000 });
await prof.waitForLoadState("networkidle");
// lecture
await prof.fill("#lectures input[name=title]", "Lecture 1 — nav clip");
await prof.setInputFiles("#lectures input[type=file]", { name: "clip.mp4", mimeType: "video/mp4", buffer: MP4 });
await prof.click("#lectures form:has(input[type=file]) button[type=submit]");
await prof.waitForSelector("text=Video uploaded", { timeout: 90000 }).catch(async (e) => {
  console.log("upload did not finish. alerts:", await prof.locator("#lectures [role=alert], #lectures [role=status], #lectures p.text-error").allInnerTexts());
  await prof.screenshot({ path: path.join(OUT, "debug-upload.png"), fullPage: true });
  throw e;
});
await prof.waitForLoadState("networkidle");
await prof.reload({ waitUntil: "networkidle" });
await prof.waitForTimeout(1500); // let the page hydrate before pressing a row action
await prof.locator("#lectures-content").getByRole("button", { name: "Publish", exact: true }).click();
await prof.waitForSelector("#lectures-heading button:has-text('1 of 1 published')", { timeout: 30000 }).catch(async (e) => {
  await prof.waitForTimeout(2000);
  console.log("publish did not take. header:", await prof.locator("#lectures-heading").innerText(), "| row:", (await prof.locator("#lectures-content li").first().innerText()).replace(/\n/g, " "));
  await prof.reload({ waitUntil: "networkidle" });
  console.log("after reload:", await prof.locator("#lectures-heading").innerText());
  throw e;
});
await prof.waitForLoadState("networkidle");
// material (link), published
const matForm = "#materials form:has(input[name=kind])";
await prof.click(`${matForm} label:has-text("Add a link")`);
await prof.fill(`${matForm} input[name=title]`, "Reading list");
await prof.fill(`${matForm} input[name=url]`, "https://example.com/reading");
await prof.click(`${matForm} button[type=submit]`);
await prof.waitForSelector(`${matForm} [role=status]:has-text("Saved")`, { timeout: 45000 });
await prof.waitForLoadState("networkidle");
await prof.reload({ waitUntil: "networkidle" });
await prof.waitForTimeout(1500);
await prof.locator("#materials-content").getByRole("button", { name: "Publish", exact: true }).click();
await prof.waitForSelector("#materials-heading button:has-text('1 of 1 published')", { timeout: 30000 });
await prof.waitForLoadState("networkidle");
// exam: create, one true/false question, publish
await prof.fill("#exams input[name=titleEs]", "PLACEHOLDER titulo");
await prof.fill("#exams input[name=titleEn]", "PLACEHOLDER title");
await prof.click("#exams form:has(input[name=titleEs]) button[type=submit]");
await prof.waitForURL(/\/professor\/exams\/[0-9a-f-]{36}$/, { timeout: 30000 });
await prof.waitForLoadState("networkidle");
const examUrl = prof.url();
const examId = examUrl.split("/").pop();
const add = prof.locator("div:has(> h2:text-is('Add a question'))");
await add.locator("fieldset:has(legend:text-is('What kind of question is this?')) label:has-text('True / false')").click();
await add.locator("section[aria-label='Español'] textarea").first().fill("PLACEHOLDER tf es");
await add.locator("section[aria-label='English'] textarea").first().fill("PLACEHOLDER tf en");
await add.locator("fieldset:has(legend:text-is('Which answer is correct?')) label:has-text('True')").click();
await add.locator("button:has-text('Add question')").click();
await prof.waitForSelector("text=/^1 question$/", { timeout: 30000 });
await prof.waitForLoadState("networkidle");
await prof.click("button:has-text('Publish and show to students')");
await prof.click("button:has-text('Yes, publish')");
await prof.waitForSelector("text=Live: students can take it", { timeout: 30000 });
console.log("course", courseId, "exam", examId);

const IDS_STUDENT = ["syllabus", "lectures", "materials", "exams"];
const IDS_PROF = [...IDS_STUDENT, "students"];
const sectionOrder = (page) => page.evaluate(() => [...document.querySelectorAll("main section[id]")].map((s) => s.id));
const chipLabels = (page) => page.locator("nav[aria-label='Course sections']:visible a").allInnerTexts();

// ── The checks, once per role ───────────────────────────────────────────────
async function exercise(role, cookieFile, url, ids, chipsExpected, sidebarExpected) {
  const R = `${role}`;
  const phoneCtx = await ctx(cookieFile, PHONE);
  const page = await phoneCtx.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  check(JSON.stringify(await sectionOrder(page)) === JSON.stringify(ids), `${R}: sections are in the fixed order (${ids.join(", ")})`);
  const headingOrder = await page.locator("main section[id] > h2 button").evaluateAll((els) => els.map((e) => e.querySelector("span.block")?.textContent));
  check(headingOrder[0] === "Syllabus" && headingOrder[1] === "Lectures" && headingOrder[2] === "Course materials" && headingOrder[3] === "Exams", `${R}: headings read Syllabus, Lectures, Course materials, Exams`);

  // phone: chips, no sidebar, Back link not breadcrumb
  const chips = page.locator("nav[aria-label='Course sections']:visible").first();
  check((await chips.isVisible()) && !(await visible(page.locator("aside"))), `${R} phone: chip row shows, no sidebar`);
  check(JSON.stringify(await chipLabels(page)) === JSON.stringify(chipsExpected), `${R} phone: chips are ${chipsExpected.join(", ")}`);
  const box = await page.locator("nav[aria-label='Course sections']:visible a").first().boundingBox();
  check(box.height >= 44, `${R} phone: chips are at least 44px tall (${Math.round(box.height)}px)`);
  check((await overflowOf(page)) <= 0, `${R} phone: no sideways overflow with ${chipsExpected.length} chips`);
  check((await visible(page.getByRole("link", { name: /^(My courses|Teaching)$/ }).first())) && !(await visible(page.locator("nav[aria-label='Breadcrumb']"))), `${R} phone: Back link shows, breadcrumb does not`);
  await shot(page, `${R}-phone-top`);

  // status lines live in the headers
  const statuses = await page.locator("main section[id] > h2 button span.block + span.block").allInnerTexts();
  console.log(`  ${R} statuses:`, statuses.join(" | "));
  check(statuses.length === ids.length && statuses.every((s) => s.trim().length > 0), `${R}: every section header carries a one-line status`);

  // chip jump + highlight
  for (const id of ["exams", "lectures", "syllabus"]) {
    const chip = page.locator(`nav[aria-label='Course sections']:visible a[href='#${id}']`);
    await chip.click();
    await page.waitForTimeout(900);
    const top = await page.locator(`#${id}`).evaluate((e) => Math.round(e.getBoundingClientRect().top));
    const atBottom = await page.evaluate(() => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2);
    check((top >= 60 && top <= 200) || atBottom, `${R} phone: the "${id}" chip scrolls to the section, clear of the sticky bars (top ${top}px)`);
    check((await chip.getAttribute("aria-current")) === "location", `${R} phone: "${id}" chip is aria-current`);
    check((await page.locator("nav[aria-label='Course sections']:visible a[aria-current]").count()) === 1, `${R} phone: exactly one chip is current`);
  }
  // current section follows a manual scroll
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(600);
  const lastId = ids[ids.length - 1];
  check((await page.locator(`nav[aria-label='Course sections']:visible a[href='#${lastId}']`).getAttribute("aria-current")) === "location", `${R} phone: scrolling by hand to the bottom highlights the last section (${lastId})`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  check((await page.locator("nav[aria-label='Course sections']:visible a[href='#syllabus']").getAttribute("aria-current")) === "location", `${R} phone: and back at the top it is Syllabus again`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, `${R}-phone-after-jumps`);

  // collapse / expand, remembered, content stays mounted
  const lecBtn = page.locator("#lectures-heading button");
  check((await lecBtn.getAttribute("aria-expanded")) === "true" && (await lecBtn.getAttribute("aria-controls")) === "lectures-content", `${R}: all sections start open; header button has aria-expanded and aria-controls`);
  await lecBtn.click();
  check((await lecBtn.getAttribute("aria-expanded")) === "false" && !(await page.locator("#lectures-content").isVisible()) && (await lecBtn.isVisible()), `${R}: collapsing hides the body and keeps the header (and its status) visible`);
  check((await page.locator("#lectures-content").count()) === 1, `${R}: collapsed content is still in the page (not unmounted)`);
  await shot(page, `${R}-phone-collapsed`);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  check((await page.locator("#lectures-heading button").getAttribute("aria-expanded")) === "false", `${R}: collapsed state is remembered after a reload`);
  check((await page.locator("#exams-heading button").getAttribute("aria-expanded")) === "true", `${R}: other sections stay open`);
  await page.locator("#lectures-heading button").click();
  check((await page.locator("#lectures-heading button").getAttribute("aria-expanded")) === "true", `${R}: expanding works`);

  if (role === "professor") {
    await page.fill("#materials form:has(input[name=kind]) input[name=title]", "typed before collapsing");
    await page.locator("#materials-heading button").click();
    await page.locator("#materials-heading button").click();
    check((await page.inputValue("#materials form:has(input[name=kind]) input[name=title]")) === "typed before collapsing", "professor: a half-filled form survives collapse and expand");
    await page.fill("#materials form:has(input[name=kind]) input[name=title]", "");
  }

  await phoneCtx.close();

  // reduced motion: no smooth scrolling
  const rm = await ctx(cookieFile, PHONE, { reducedMotion: "reduce" });
  const rmPage = await rm.newPage();
  await rmPage.goto(url, { waitUntil: "networkidle" });
  check((await rmPage.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)) === "auto", `${R}: prefers-reduced-motion turns smooth scrolling off`);
  await rm.close();

  // storage blocked: still renders, toggle still works for the visit
  const nb = await ctx(cookieFile, PHONE);
  await nb.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
  });
  const nbPage = await nb.newPage();
  const errors = [];
  nbPage.on("pageerror", (e) => errors.push(e.message));
  await nbPage.goto(url, { waitUntil: "networkidle" });
  await nbPage.locator("#exams-heading button").click();
  check(errors.length === 0 && (await nbPage.locator("#exams-heading button").getAttribute("aria-expanded")) === "false", `${R}: with browser storage blocked the page renders and collapsing still works`);
  await nb.close();

  // desktop
  const wideCtx = await ctx(cookieFile, WIDE);
  const wide = await wideCtx.newPage();
  await wide.goto(url, { waitUntil: "networkidle" });
  await wide.waitForTimeout(300);
  const side = wide.locator("aside nav[aria-label='Course sections']");
  check(await side.isVisible(), `${R} desktop: the sidebar shows`);
  check(JSON.stringify(await side.locator("a").allInnerTexts()) === JSON.stringify(sidebarExpected), `${R} desktop: sidebar lists ${sidebarExpected.join(", ")} in order`);
  check((await wide.locator("nav[aria-label='Course sections']:visible").count()) === 1, `${R} desktop: only one section navigation is visible`);
  const sideBox = await side.boundingBox();
  const secBox = await wide.locator("#lectures").boundingBox();
  check(sideBox.x + sideBox.width <= secBox.x && sideBox.width >= 200 && sideBox.width <= 240, `${R} desktop: sidebar sits left of the sections (${Math.round(sideBox.width)}px wide)`);
  const crumb = wide.locator("nav[aria-label='Breadcrumb']");
  check((await crumb.isVisible()) && (await crumb.locator("a").count()) >= 1 && (await crumb.locator("[aria-current=page]").count()) === 1, `${R} desktop: breadcrumb shows with the current page marked`);
  check(!(await visible(wide.locator("main a:has(svg path[d='M10 3 5 8l5 5'])"))), `${R} desktop: the breadcrumb replaces the Back link`);
  await wide.locator("aside a[href='#exams']").click();
  await wide.waitForTimeout(900);
  check((await wide.locator("aside a[href='#exams']").getAttribute("aria-current")) === "location", `${R} desktop: sidebar highlights the section you jumped to`);
  await shot(wide, `${R}-desktop`);
  await wideCtx.close();
}

await exercise("professor", ".auth/prof.json", courseUrl, IDS_PROF, ["Syllabus", "Lectures", "Materials", "Exams", "Students"], ["Syllabus", "Lectures", "Course materials", "Exams", "Students"]);
await exercise("student", ".auth/student.json", `${BASE_URL}/courses/${courseId}`, IDS_STUDENT, ["Syllabus", "Lectures", "Materials", "Exams"], ["Syllabus", "Lectures", "Course materials", "Exams"]);

// ── Breadcrumbs on the other pages (desktop) and Back links (phone) ─────────
const studentWide = await (await ctx(".auth/student.json", WIDE)).newPage();
const studentPhone = await (await ctx(".auth/student.json", PHONE)).newPage();
await studentWide.goto(`${BASE_URL}/courses/${courseId}`, { waitUntil: "networkidle" });
const lecHref = await studentWide.locator("#lectures a[href*='/lectures/']").first().getAttribute("href");
const pages = [
  ["student lecture", lecHref, ["My courses", "Lectures"]],
  ["student exam", `/courses/${courseId}/exams/${examId}`, ["My courses", "Course", "Exams"]],
];
for (const [name, href, links] of pages) {
  await studentWide.goto(`${BASE_URL}${href}`, { waitUntil: "domcontentloaded" }); // a lecture page keeps its video request open
  await studentWide.waitForSelector("h1");
  const trail = studentWide.locator("nav[aria-label='Breadcrumb']");
  const got = await trail.locator("a").allInnerTexts();
  check(links.every((l) => got.includes(l)) && (await trail.locator("[aria-current=page]").count()) === 1, `${name} desktop: breadcrumb has ${links.join(" › ")} and a current page`);
  await shot(studentWide, `${name.replace(" ", "-")}-desktop`);
  await studentPhone.goto(`${BASE_URL}${href}`, { waitUntil: "domcontentloaded" });
  await studentPhone.waitForSelector("h1");
  check(!(await visible(studentPhone.locator("nav[aria-label='Breadcrumb']"))) && (await studentPhone.locator("main a:has(svg path[d='M10 3 5 8l5 5'])").first().isVisible()), `${name} phone: the Back link stays, no breadcrumb`);
}
// exam reading column is centred on desktop (and full-width on phones)
await studentWide.goto(`${BASE_URL}/courses/${courseId}/exams/${examId}`, { waitUntil: "networkidle" });
const col = await studentWide.locator("main > div").first().boundingBox();
const mainBox = await studentWide.locator("main").boundingBox();
check(Math.abs(col.x + col.width / 2 - (mainBox.x + mainBox.width / 2)) <= 4 && col.width <= 700, `exam page: centred reading column on desktop (${Math.round(col.width)}px wide)`);
await studentPhone.goto(`${BASE_URL}/courses/${courseId}/exams/${examId}`, { waitUntil: "networkidle" });
const pcol = await studentPhone.locator("main > div").first().boundingBox();
check(pcol.width >= 340, `exam page: full width on phones (${Math.round(pcol.width)}px)`);

// professor trails
const profWide = await (await ctx(".auth/prof.json", WIDE)).newPage();
const profPhone = await (await ctx(".auth/prof.json", PHONE)).newPage();
for (const [name, href, links] of [
  ["professor exam builder", `/professor/exams/${examId}`, ["Teaching", "Course", "Exams"]],
  ["professor submissions", `/professor/exams/${examId}/submissions`, ["Teaching", "Course", "Exams"]],
  ["professor course edit", `/professor/courses/${courseId}/edit`, ["Teaching"]],
]) {
  await profWide.goto(`${BASE_URL}${href}`, { waitUntil: "networkidle" });
  const trail = profWide.locator("nav[aria-label='Breadcrumb']");
  const got = await trail.locator("a").allInnerTexts();
  check(links.every((l) => got.includes(l)) && (await trail.locator("[aria-current=page]").count()) === 1, `${name} desktop: breadcrumb ${links.join(" › ")} › current`);
  await profPhone.goto(`${BASE_URL}${href}`, { waitUntil: "networkidle" });
  check(!(await visible(profPhone.locator("nav[aria-label='Breadcrumb']"))), `${name} phone: no breadcrumb (Back link stays)`);
  await shot(profPhone, `${name.replaceAll(" ", "-")}-phone`);
}

await browser.close();
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
