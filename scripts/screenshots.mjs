#!/usr/bin/env node
// Screenshot a list of paths at phone (375×812) and desktop (1280×800) widths
// for the frontend audit ("does every screen look correct at 375px?").
//
//   pnpm screenshots                       # public pages against localhost:3000
//   BASE_URL=http://localhost:3100 pnpm screenshots /login /register
//   COOKIE_FILE=./.auth/student.json pnpm screenshots /dashboard   # signed-in
//
// Output: .screenshots/<viewport>/<path>.png (git-ignored). Also prints any
// horizontal overflow at 375px, which is the most common mobile bug.
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? ".screenshots";
const paths = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["/login", "/register", "/reset-password", "/this-does-not-exist"];

const viewports = {
  phone: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
};

const browser = await chromium.launch();
let problems = 0;

for (const [name, vp] of Object.entries(viewports)) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile ?? false,
    hasTouch: vp.hasTouch ?? false,
  });
  if (process.env.COOKIE_FILE) {
    const cookies = JSON.parse(await readFile(process.env.COOKIE_FILE, "utf8"));
    await context.addCookies(cookies);
  }
  const page = await context.newPage();
  await mkdir(path.join(OUT, name), { recursive: true });

  for (const p of paths) {
    const url = new URL(p, BASE_URL).toString();
    const res = await page.goto(url, { waitUntil: "networkidle" });
    const file = path.join(OUT, name, (p === "/" ? "home" : p.replace(/^\//, "").replace(/\//g, "__")) + ".png");
    await page.screenshot({ path: file, fullPage: true });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    const finalPath = new URL(page.url()).pathname;
    const note = finalPath !== p ? ` → ${finalPath}` : "";
    const status = res?.status() ?? "?";
    let line = `${name.padEnd(8)} ${status} ${p}${note}  ${file}`;
    if (overflow > 0) {
      line += `  ⚠ horizontal overflow ${overflow}px`;
      problems++;
    }
    console.log(line);
  }
  await context.close();
}

await browser.close();
if (problems) {
  console.error(`\n${problems} page(s) overflow horizontally.`);
  process.exit(1);
}
