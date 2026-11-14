#!/usr/bin/env node
// End-to-end check of embedded YouTube lectures with the dev seed accounts,
// against a real Supabase project, at phone width (375px) and desktop (1280px).
//
// THE YOUTUBE IFRAME API IS STUBBED. This machine may not reach YouTube and
// cannot decode H.264, so every request for https://www.youtube.com/iframe_api
// is answered with a fake `YT.Player` (below) that behaves like the real one
// where it matters: it creates an <iframe>, fires onReady / onStateChange /
// onPlaybackRateChange, advances its position in REAL time, gives no event for
// a seek, and reports a duration the script controls. Everything else is real:
// the pages, the server actions, the stream route, the progress route and its
// wall-clock rules, the database. A real YouTube video on a real phone is still
// needed for what a stub cannot show; the list is in PROGRESS.md and the PR.
// No real video id is used anywhere: "PLACEHOLD01" is eleven valid characters
// that name nothing.
//
//   professor: course; add-lecture choice comes first; YouTube form reads the
//     length from the (stubbed) player and fills it, manual override, "Use"
//     button, fallback when no length is reported, plain errors, kept input;
//     two YouTube lectures created and published; rows say YouTube; the edit
//     page fixes the source and lets link/length change; question 1 written and
//     turned on for lecture A.
//   student: the player uses the nocookie host, nothing covers the player, the
//     note sits outside it; seeking forward is not credited; resume position;
//     speed notice above ~1.4x outside the box and never blocking; IFrame API
//     blocked -> message + Try again; lecture A played to the end in real time ->
//     completion banner AND the comprehension card appear in the same page (no
//     reload); no video id in any page HTML.
//   instructor preview: player works, no progress request is ever sent.
//
//   BASE_URL=http://localhost:3100 pnpm flow-lecture-youtube
// Requires .auth/prof.json and .auth/student.json from `pnpm auth-session`.
// Takes about two minutes (a 24 second lecture is played in real time).
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* env may already be set */
}

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? ".screenshots/flow-lecture-youtube";
const STUDENT_EMAIL = process.env.STUDENT_EMAIL ?? "student-1@example.test";
const title = `Audit youtube ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
const FAKE_ID = "PLACEHOLD01";
const LENGTH = 24; // seconds, for the stub and the saved lectures

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
const visible = (loc) => loc.first().isVisible().catch(() => false);
const settle = async (page) => {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200); // let the page hydrate before typing into controlled fields
};
/** Every matching element is at least 44px tall. */
async function minHeights(loc, name, min = 44) {
  const hs = await loc.evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().height)));
  check(hs.length > 0 && hs.every((h) => h >= min), `${name}: touch targets >= ${min}px (${hs.length} checked, smallest ${Math.min(...hs)}px)`);
}

// ── The stubbed IFrame API ──────────────────────────────────────────────────
const STUB = `
(function () {
  window.__ytCreated = 0;
  function Player(el, opts) {
    var self = this;
    this.opts = opts;
    this.state = -1;
    this.rate = 1;
    this.t = (opts.playerVars && opts.playerVars.start) || 0;
    this.last = Date.now();
    var f = document.createElement("iframe");
    f.title = "Fake YouTube player";
    f.setAttribute("data-host", opts.host);
    f.setAttribute("data-video", opts.videoId);
    f.setAttribute("allowfullscreen", "");
    f.srcdoc = "<body style='margin:0;background:#222;color:#eee'>fake player</body>";
    el.parentNode.replaceChild(f, el);
    this.iframe = f;
    window.__yt = this;
    window.__ytOpts = opts;
    window.__ytCreated++;
    this.timer = setInterval(function () { self.tick(); }, 100);
    setTimeout(function () { self.emit("onReady", 0); }, 50);
  }
  Player.prototype = {
    emit: function (name, data) {
      var ev = this.opts.events || {};
      if (ev[name]) ev[name]({ data: data, target: this });
    },
    // Position advances with real time while playing; reaching the end fires "ended".
    tick: function () {
      var now = Date.now();
      if (this.state === 1) {
        this.t += ((now - this.last) / 1000) * this.rate;
        var len = typeof window.__ytLength === "number" ? window.__ytLength : ${LENGTH};
        if (this.t >= len) { this.t = len; this.state = 0; this.emit("onStateChange", 0); }
      }
      this.last = now;
    },
    getCurrentTime: function () { return this.t; },
    getPlayerState: function () { return this.state; },
    getPlaybackRate: function () { return this.rate; },
    getDuration: function () { return typeof window.__ytDuration === "number" ? window.__ytDuration : ${LENGTH}; },
    destroy: function () { clearInterval(this.timer); if (this.iframe.parentNode) this.iframe.remove(); },
    // test controls
    play: function () { this.tick(); this.state = 1; this.emit("onStateChange", 1); },
    pause: function () { this.tick(); this.state = 2; this.emit("onStateChange", 2); },
    seek: function (t) { this.tick(); this.t = t; }, // YouTube gives no seek event
    setRate: function (r) { this.tick(); this.rate = r; this.emit("onPlaybackRateChange", r); }
  };
  window.YT = { Player: Player, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  setTimeout(function () { if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady(); }, 0);
})();
`;
const stubRoute = (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: STUB });
const ctx = async (cookieFile, opts = WIDE) => {
  const c = await browser.newContext(opts);
  await c.addCookies(JSON.parse(await readFile(cookieFile, "utf8")));
  await c.route("https://www.youtube.com/iframe_api", stubRoute);
  return c;
};
const player = (page) => page.getByRole("region", { name: /^(Video player|YouTube preview)/ });
const waitForPlayer = (page) =>
  page.waitForSelector("iframe[data-video]", { timeout: 30000 }).catch(async (e) => {
    console.log(`no player at ${page.url()}; page says:`, (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300));
    throw e;
  });
const openLecture = async (page, url) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForPlayer(page);
  await page.waitForTimeout(600); // let onReady run
};
/** Elements at five points inside the player box are all the player's own iframe (nothing is drawn over it). */
const coveredBy = (page) =>
  page.evaluate(() => {
    const box = document.querySelector('[role=region][aria-label^="Video player"], [role=region][aria-label="YouTube preview"]');
    box.scrollIntoView({ block: "center", behavior: "instant" });
    const r = box.getBoundingClientRect();
    return [[0.1, 0.1], [0.5, 0.5], [0.9, 0.9], [0.5, 0.95], [0.05, 0.5]].map(([fx, fy]) => {
      const el = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
      return el ? el.tagName : "none";
    });
  });

// ── Professor ───────────────────────────────────────────────────────────────
const profCtx = await ctx(".auth/prof.json", PHONE);
const prof = await profCtx.newPage();
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

await prof.goto(courseUrl, { waitUntil: "networkidle" });
await settle(prof);
check((await prof.locator("#lectures input[type=file]").count()) === 0 && (await prof.locator("#lectures input[name=youtubeUrl]").count()) === 0, "add a lecture: the source choice comes first, no form is shown yet");
await minHeights(prof.locator("#lectures label:has(input[name=lecture-source])"), "source choice (phone)");
await shot(prof, "prof-add-choice-phone");

await prof.locator("#lectures label:has(input[name=lecture-source][value=upload])").click();
check((await prof.locator("#lectures input[type=file]").count()) === 1 && (await prof.locator("#lectures input[name=youtubeUrl]").count()) === 0, "choosing 'Upload a video' shows the upload form only");
await prof.locator("#lectures label:has(input[name=lecture-source][value=youtube])").click();
check((await prof.locator("#lectures input[type=file]").count()) === 0 && (await prof.locator("#lectures input[name=youtubeUrl]").count()) === 1, "choosing 'YouTube link' shows the YouTube form only");
check(await visible(prof.getByText("don't use YouTube for content that must stay enrolled-only", { exact: false })), "the YouTube form warns that unlisted videos are not access-controlled");

const yt = (sel) => prof.locator(`#lectures ${sel}`);
const minutes = () => prof.locator("#lectures").getByLabel("Minutes", { exact: true });
const seconds = () => prof.locator("#lectures").getByLabel("Seconds", { exact: true });
const submitYt = () => yt("form:has(input[name=youtubeUrl]) button[type=submit]");

// A bad link is explained as you type
await yt("input[name=youtubeUrl]").fill(`https://example.com/watch?v=${FAKE_ID}`);
check(await visible(prof.getByText("That isn't a YouTube video link.", { exact: false })), "a link that isn't YouTube is explained immediately");
check((await prof.locator("#lectures iframe[data-video]").count()) === 0, "...and no preview is loaded for it");

// A good link: preview loads from the nocookie host, the length is read and filled in
await yt("input[name=youtubeUrl]").fill(`https://youtu.be/${FAKE_ID}`);
await prof.waitForSelector("#lectures iframe[data-video]", { timeout: 30000 });
check((await prof.locator("#lectures iframe[data-video]").getAttribute("data-video")) === FAKE_ID, "a valid link loads the preview for that video id");
check((await prof.locator("#lectures iframe[data-video]").getAttribute("data-host")) === "https://www.youtube-nocookie.com", "the preview uses the privacy-enhanced host");
await prof.waitForSelector("text=YouTube reports a length of 0:24.", { timeout: 15000 });
check((await minutes().inputValue()) === "0" && (await seconds().inputValue()) === "24", "the length read from the player fills the minutes and seconds boxes");
check(await visible(prof.getByText("This lecture will be saved as 0:24 long.")), "the saved length is stated back in minutes:seconds");
check(await visible(prof.getByText("A length that is too long makes the lecture hard to complete", { exact: false })), "the hint says a wrong length makes completion too hard or too easy");
const previewCover = await coveredBy(prof);
check(previewCover.every((t) => t === "IFRAME"), `nothing is drawn over the preview player (${previewCover.join(",")})`);

// Manual override wins, and the read value is offered back
await seconds().fill("20");
check(await visible(prof.getByText("saved as 0:20 long", { exact: false })), "a typed length overrides the read one");
check(await visible(prof.getByRole("button", { name: "Use 0:24" })), "...and 'Use 0:24' offers the read value back");
await minHeights(prof.getByRole("button", { name: "Use 0:24" }), "'Use' button");
await seconds().fill("75");
check(await visible(prof.getByText("Seconds must be between 0 and 59.")), "an impossible number of seconds is explained");
await prof.getByRole("button", { name: "Use 0:24" }).click();
check((await minutes().inputValue()) === "0" && (await seconds().inputValue()) === "24", "'Use 0:24' puts the read value back");
await minHeights(prof.locator("#lectures input[inputmode=numeric], #lectures input[name=youtubeUrl], #lectures input[name=title]"), "YouTube form inputs (phone)", 40);
await minHeights(prof.locator("#lectures input[inputmode=numeric]"), "minutes and seconds boxes (phone)");
await shot(prof, "prof-youtube-form-phone");

// Server errors are shown as written, and what was typed is kept
await submitYt().click(); // title is empty
await prof.waitForSelector("text=Title is required", { timeout: 20000 }).catch(() => {});
const titleError = await prof.locator("#lectures [id$='-error']").first().innerText().catch(() => "");
check(titleError.length > 0, `a missing title is refused with the server's message ("${titleError.slice(0, 60)}")`);
check((await yt("input[name=youtubeUrl]").inputValue()).includes(FAKE_ID) && (await seconds().inputValue()) === "24", "...and the link and length are kept");

// Lecture A: length read from the player
await yt("input[name=title]").fill("Audit YouTube A");
await yt("textarea[name=description]").fill("Description for lecture A.");
await submitYt().click();
await prof.waitForSelector("text=Lecture added as a draft.", { timeout: 30000 }).catch(async (e) => {
  console.log("add did not report success; page says:", (await prof.locator("[role=alert], [role=status], [id$='-error']").allInnerTexts()).join(" | ").slice(0, 400));
  throw e;
});
check((await yt("input[name=youtubeUrl]").inputValue()) === "", "after adding, the form starts empty again");

// Lecture B: the player reports no length (a live stream, or metadata not loaded) -> manual entry
await prof.evaluate(() => {
  window.__ytDuration = 0;
});
await prof.waitForSelector("#lectures input[name=title]:not([disabled])", { timeout: 30000 }); // fields stay disabled until the list has refreshed
await yt("input[name=title]").fill("Audit YouTube B");
await yt("input[name=youtubeUrl]").fill(`https://www.youtube.com/watch?v=${FAKE_ID}`);
await prof.waitForSelector("text=YouTube didn't report a length", { timeout: 20000 });
check(await visible(prof.getByText("Enter it in the boxes above.", { exact: false })), "no length reported: the form says so and asks for it by hand");
await submitYt().click();
await prof.waitForSelector("text=Duration is required.", { timeout: 15000 }).catch(() => {});
check(await visible(prof.getByText("Duration is required.", { exact: false })), "submitting without a length gives the server's 'Duration is required.'");
await minutes().fill("0");
await seconds().fill(String(LENGTH));
await submitYt().click();
await prof.waitForSelector("text=Lecture added as a draft.", { timeout: 30000 });

await prof.goto(courseUrl, { waitUntil: "networkidle" });
await settle(prof);
const rows = await prof.locator("#lectures-content li").allInnerTexts();
check(rows.length === 2 && rows.every((t) => t.includes("YouTube") && t.includes("Draft") && t.includes("0:24")), "both lectures are drafts, say YouTube, and show their length");
check(!(await prof.locator("#lectures-content").getByRole("button", { name: "Upload video" }).count()), "a YouTube lecture never offers 'Upload video'");
const hrefs = await prof.locator("#lectures-content li").evaluateAll((lis) =>
  lis.map((li) => [...li.querySelectorAll("a")].find((a) => a.textContent.trim() === "Edit")?.getAttribute("href")),
);
const [editA, editB] = hrefs;
const lectureA = editA.split("/")[3];
const lectureB = editB.split("/")[3];
await shot(prof, "prof-course-lectures-phone");

// ── Professor: edit page ────────────────────────────────────────────────────
await prof.goto(`${BASE_URL}${editA}`, { waitUntil: "networkidle" });
await settle(prof);
check(await visible(prof.getByText("Video source:")) && (await prof.locator("main").innerText()).includes("YouTube"), "edit page: shows the source as YouTube");
check((await prof.locator("input[name=lecture-source]").count()) === 0, "edit page: there is no way to change the source");
await prof.waitForSelector("iframe[data-video]", { timeout: 30000 });
check((await prof.locator("iframe[data-video]").getAttribute("data-video")) === FAKE_ID, "edit page: previews the current video (professor-only page)");
await prof.waitForSelector("text=YouTube reports a length of 0:24.", { timeout: 15000 });
check((await prof.getByLabel("Minutes", { exact: true }).inputValue()) === "0" && (await prof.getByLabel("Seconds", { exact: true }).inputValue()) === "24", "edit page: the saved length stays (the read length does not overwrite it)");
check((await prof.getByRole("button", { name: /^Use / }).count()) === 0, "edit page: no 'Use' offer when the read length equals the saved one");
await prof.getByLabel("Seconds", { exact: true }).fill("30");
check(await visible(prof.getByRole("button", { name: "Use 0:24" })), "edit page: a different typed length offers the read one");
await prof.getByLabel("Seconds", { exact: true }).fill("24");

await prof.fill("#title", "Audit YouTube A (edited)");
await prof.fill("input[name=youtubeUrl]", "https://example.com/nope");
await prof.click("form:has(input[name=youtubeUrl]) button[type=submit]");
await prof.waitForTimeout(1500);
check(await visible(prof.getByText("That isn't a YouTube video link.", { exact: false })), "edit page: a bad new link is refused with a plain message");
check((await prof.locator("input[name=youtubeUrl]").inputValue()) === "https://example.com/nope" && (await prof.inputValue("#title")) === "Audit YouTube A (edited)", "edit page: a failed save keeps the typed link and title");
await shot(prof, "prof-edit-youtube-error-phone");
await prof.fill("input[name=youtubeUrl]", "");
await prof.click("form:has(input[name=youtubeUrl]) button[type=submit]");
await prof.waitForURL(`${BASE_URL}/professor/courses/${courseId}`, { timeout: 30000 });
check(true, "edit page: a blank link keeps the video and saving returns to the course");

// ── Professor: question 1 on lecture A (so the card can appear on completion) ──
await prof.goto(`${BASE_URL}${editA}`, { waitUntil: "networkidle" });
await settle(prof);
await shot(prof, "prof-edit-youtube-phone");
const slot = prof.locator("#comprehension-q1");
await slot.locator('textarea[id$="-prompt-es"]').fill("Question 1 es");
await slot.locator('textarea[id$="-prompt-en"]').fill("Question 1 en");
for (const [i, n] of ["A", "B", "C"].entries()) {
  await slot.locator(`input[id$="-opt-${i}-es"]`).fill(`Option ${n} es`);
  await slot.locator(`input[id$="-opt-${i}-en"]`).fill(`Option ${n} en`);
}
await slot.locator('label:has-text("Correct answer")').nth(1).click();
await prof.getByRole("button", { name: "Save question" }).click();
await prof.waitForSelector("text=Comprehension question saved.", { timeout: 30000 }).catch(async (e) => {
  console.log("save did not report success; alerts:", (await prof.locator("[role=alert], [role=status]").allInnerTexts()).join(" | ").slice(0, 400));
  throw e;
});
await prof.waitForSelector("text=The saved question is complete in Spanish and English.", { timeout: 30000 });
await prof.getByRole("button", { name: "Turn on", exact: true }).click();
await prof.waitForSelector("text=On: students are asked", { timeout: 30000 });

// publish both
await prof.goto(courseUrl, { waitUntil: "networkidle" });
await settle(prof);
for (const k of [1, 2]) {
  await prof.locator("#lectures-content").getByRole("button", { name: "Publish", exact: true }).first().click();
  await prof.waitForSelector(`#lectures-heading button:has-text('${k} of 2 published')`, { timeout: 30000 }).catch(async (e) => {
    console.log("publish did not take; page says:", (await prof.locator("#lectures-content").innerText()).replace(/\s+/g, " ").slice(0, 400));
    throw e;
  });
  await prof.reload({ waitUntil: "networkidle" });
  await prof.waitForTimeout(1200);
}
check(true, "both YouTube lectures publish");

// ── Student ─────────────────────────────────────────────────────────────────
const studentCtx = await ctx(".auth/student.json", PHONE);
const student = await studentCtx.newPage();
const lectureUrl = (id) => `${BASE_URL}/courses/${courseId}/lectures/${id}`;
const progressPosts = [];
student.on("request", (r) => {
  if (r.url().includes("/progress") && r.method() === "POST") progressPosts.push(r.url());
});

// The id is in no page HTML (only the access-checked stream route hands it out)
for (const url of [`${BASE_URL}/courses/${courseId}`, lectureUrl(lectureA), lectureUrl(lectureB)]) {
  const html = await (await studentCtx.request.get(url)).text();
  check(!html.includes(FAKE_ID), `student HTML for ${url.replace(BASE_URL, "")} carries no YouTube id`);
}

// Lecture B: embed rules, seek, resume, speed
await openLecture(student, lectureUrl(lectureB));
const iframe = student.locator("iframe[data-video]");
check((await iframe.getAttribute("data-host")) === "https://www.youtube-nocookie.com", "student: the player is framed from youtube-nocookie.com");
check((await student.evaluate(() => window.__ytOpts.playerVars.origin)) === new URL(BASE_URL).origin, "student: the player is told this site's origin");
check((await iframe.getAttribute("data-video")) === FAKE_ID, "student: the id came from the stream route and reached the player");
check((await player(student).locator("button, a, [role=slider]").count()) === 0, "student: the player box holds no custom buttons or links of ours");
check((await coveredBy(student)).every((t) => t === "IFRAME"), "student: nothing is drawn over the player (five points checked)");
const note = student.getByText("This video plays from YouTube", { exact: false });
check((await visible(note)) && (await player(student).getByText("plays from YouTube", { exact: false }).count()) === 0, "student: the 'plays from YouTube' note is shown outside the player box");
check((await student.getByRole("region", { name: "Quick check" }).count()) === 0, "student: no question card before the lecture is complete");
const box = await player(student).boundingBox();
check(box.width >= 375 - 1 && box.width >= 200 && Math.abs(box.height - (box.width * 9) / 16) < 2, `student: the player is 16:9 and edge to edge on a phone (${Math.round(box.width)}x${Math.round(box.height)})`);
await shot(student, "student-youtube-phone");

// seek forward is never blocked, and not credited
const percentNow = async () => Number(await student.getByRole("progressbar", { name: "Lecture progress" }).getAttribute("aria-valuenow"));
await student.evaluate(() => window.__yt.play());
await student.waitForTimeout(3200);
await student.evaluate(() => window.__yt.seek(14)); // skip 14 seconds ahead
await student.waitForTimeout(4600);
await student.evaluate(() => window.__yt.pause());
// the first progress request compiles the route in dev, so wait for the server's number to settle
await student.waitForFunction(() => Number(document.querySelector('[role=progressbar][aria-label="Lecture progress"]')?.getAttribute("aria-valuenow")) >= 15, null, { timeout: 30000 }).catch(() => {});
await student.waitForTimeout(1500);
const pct = await percentNow();
check(pct >= 15 && pct <= 45, `student: skipping ahead was not credited (server says ${pct}% after about 8 s watched of ${LENGTH} s)`);
check((await student.evaluate(() => window.__yt.state)) === 2, "student: the seek and pause were never blocked or snapped back");

// resume from the saved position
await student.reload({ waitUntil: "domcontentloaded" });
await waitForPlayer(student);
const start = await student.evaluate(() => window.__ytOpts.playerVars.start);
check(start >= 16 && start <= 20, `student: reopening resumes near where they stopped (start=${start}s)`);

// speed notice
await student.waitForTimeout(600);
await student.evaluate(() => window.__yt.setRate(1.25));
check((await student.getByText("Progress counts only up to about 1.5× speed", { exact: false }).count()) === 0, "student: no speed notice at 1.25×");
await student.evaluate(() => window.__yt.setRate(1.75));
const speed = student.getByText("Progress counts only up to about 1.5× speed", { exact: false });
check(await visible(speed), "student: a notice appears above about 1.4× speed");
check((await player(student).getByText("1.5× speed", { exact: false }).count()) === 0 && (await coveredBy(student)).every((t) => t === "IFRAME"), "student: the speed notice is outside the player and covers nothing");
check((await student.evaluate(() => window.__yt.rate)) === 1.75, "student: the speed is never forced back or blocked");
await shot(student, "student-youtube-speed-phone");
await student.evaluate(() => window.__yt.setRate(1));
check((await speed.count()) === 0, "student: the notice clears when the speed comes back down");

// IFrame API blocked: a clear message, no box, Try again
const blocked = await studentCtx.newPage();
await blocked.route("https://www.youtube.com/iframe_api", (route) => route.abort());
await blocked.goto(lectureUrl(lectureB), { waitUntil: "domcontentloaded" });
await blocked.waitForSelector("text=The YouTube player couldn't load.", { timeout: 30000 });
check(true, "blocked API: a clear message is shown");
check((await blocked.getByRole("region", { name: /^Video player/ }).isVisible().catch(() => false)) === false, "blocked API: no empty player box is left behind");
check((await blocked.getByRole("link", { name: /open on youtube/i }).count()) === 0, "blocked API: no 'Open on YouTube' link is offered");
await minHeights(blocked.getByRole("button", { name: "Try again" }), "'Try again' button (phone)");
await shot(blocked, "student-youtube-blocked-phone");
await blocked.unroute("https://www.youtube.com/iframe_api");
await blocked.route("https://www.youtube.com/iframe_api", stubRoute);
await blocked.getByRole("button", { name: "Try again" }).click();
await blocked.waitForSelector("iframe[data-video]", { timeout: 30000 });
check(await visible(player(blocked)), "blocked API: 'Try again' loads the player once YouTube is reachable");
await blocked.close();

// Lecture A: played to the end in real time -> banner and question card appear in the same page
await openLecture(student, lectureUrl(lectureA));
check((await student.getByRole("region", { name: "Quick check" }).count()) === 0, "student: lecture A starts with no question card");
await student.evaluate(() => {
  window.__noReload = true;
  window.__yt.play();
});
await student.waitForSelector("text=Lecture complete", { timeout: 90000 });
check(true, "student: the completion banner appears after playing the lecture through (server-validated)");
await student.getByRole("region", { name: "Quick check" }).waitFor({ timeout: 30000 });
check(await student.evaluate(() => window.__noReload === true), "student: the question card appeared without reloading the page");
check((await student.getByRole("region", { name: "Quick check" }).innerText()).includes("Question 1 es"), "student: the card asks Question 1 (Español by default)");
await shot(student, "student-youtube-complete-phone");
await student.reload({ waitUntil: "domcontentloaded" });
await waitForPlayer(student);
await student.waitForSelector("text=Lecture complete", { timeout: 20000 });
check((await student.evaluate(() => window.__ytOpts.playerVars.start)) === 0, "student: a finished lecture reopens from the start");
check(await visible(student.getByRole("region", { name: "Quick check" })), "student: the card is still there after a reload");

// ── Instructor preview: works, records nothing ──────────────────────────────
const previewPosts = [];
prof.on("request", (r) => {
  if (r.url().includes("/progress") && r.method() === "POST") previewPosts.push(r.url());
});
await openLecture(prof, lectureUrl(lectureA));
check(await visible(prof.getByText("Preview — progress isn't recorded for instructors.")), "preview: the page says progress isn't recorded");
await prof.evaluate(() => window.__yt.play());
await prof.waitForTimeout(3500);
await prof.evaluate(() => window.__yt.setRate(2));
check((await prof.getByText("Progress counts only up to about 1.5× speed", { exact: false }).count()) === 0, "preview: no speed notice (nothing is being counted)");
await prof.evaluate(() => window.__yt.pause());
await prof.waitForTimeout(2000);
check(previewPosts.length === 0, `preview: the player works and no progress request is ever sent (${previewPosts.length})`);
check(await visible(prof.getByRole("region", { name: "Quick check (instructor preview)" })), "preview: the question shows read-only as before");
await shot(prof, "prof-preview-youtube-phone");

// ── Desktop ─────────────────────────────────────────────────────────────────
const sw = await (await ctx(".auth/student.json", WIDE)).newPage();
await openLecture(sw, lectureUrl(lectureB));
await shot(sw, "student-youtube-desktop");
const pw = await (await ctx(".auth/prof.json", WIDE)).newPage();
await pw.goto(courseUrl, { waitUntil: "networkidle" });
await settle(pw);
await pw.locator("#lectures label:has(input[name=lecture-source][value=youtube])").click();
await shot(pw, "prof-youtube-form-desktop");
await pw.goto(`${BASE_URL}${editA}`, { waitUntil: "networkidle" });
await shot(pw, "prof-edit-youtube-desktop");

await browser.close();
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
