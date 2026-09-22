#!/usr/bin/env node
// Press Tab through a page at phone width and print what receives focus and
// whether it shows a visible focus ring — for the frontend audit item
// "Can I tab through the whole app?".
//
//   pnpm tab-order /login
//   BASE_URL=http://localhost:3100 COOKIE_FILE=.auth/student.json pnpm tab-order /dashboard
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const path = process.argv[2] ?? "/login";
const MAX_TABS = Number(process.env.MAX_TABS ?? 40);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
if (process.env.COOKIE_FILE) {
  context.addCookies(JSON.parse(await readFile(process.env.COOKIE_FILE, "utf8")));
}
const page = await context.newPage();
await page.goto(new URL(path, BASE_URL).toString(), { waitUntil: "networkidle" });

let noRing = 0;
for (let i = 0; i < MAX_TABS; i++) {
  await page.keyboard.press("Tab");
  const d = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const label =
      el.getAttribute("aria-label") ||
      el.textContent?.trim().replace(/\s+/g, " ").slice(0, 32) ||
      el.getAttribute("placeholder") ||
      "";
    const cs = getComputedStyle(el);
    const ring = cs.boxShadow !== "none" || (cs.outlineStyle !== "none" && cs.outlineWidth !== "0px");
    const role = el.getAttribute("role") ? `[${el.getAttribute("role")}]` : "";
    return { desc: `${el.tagName.toLowerCase()}${role} "${label}"`, ring };
  });
  if (!d) {
    console.log(`${String(i + 1).padStart(2)}  (body — end of tab sequence)`);
    break;
  }
  if (!d.ring) noRing++;
  console.log(`${String(i + 1).padStart(2)}  ${d.ring ? "◉" : "○"}  ${d.desc}`);
}
await browser.close();
if (noRing) {
  console.error(`\n${noRing} focusable element(s) without a visible focus ring.`);
  process.exit(1);
}
