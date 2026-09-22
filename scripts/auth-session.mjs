#!/usr/bin/env node
// Sign in through the real /login form and save the session cookies so the
// other audit scripts can screenshot / tab through signed-in screens.
//
//   BASE_URL=http://localhost:3100 pnpm auth-session prof-a@example.test .auth/prof.json
//   (password read from AUTH_PASSWORD; defaults to the integration-test seed password)
//
// Only ever use dev-only accounts (the @example.test seed users). Cookie
// files land in .auth/, which is git-ignored.
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const [email, out = ".auth/session.json"] = process.argv.slice(2);
const password = process.env.AUTH_PASSWORD ?? "integration-test-password";
if (!email) {
  console.error("usage: auth-session <email> [out.json]");
  process.exit(2);
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(new URL("/login", BASE_URL).toString(), { waitUntil: "networkidle" });
await page.fill("#email", email);
await page.fill("#password", password);
await page.click("button[type=submit]");
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {});

const landed = new URL(page.url()).pathname;
if (landed.startsWith("/login")) {
  const err = await page.locator("[role=alert]").first().textContent().catch(() => null);
  console.error(`Sign-in failed for ${email}: ${err ?? "still on /login"}`);
  await browser.close();
  process.exit(1);
}

const cookies = await context.cookies();
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(cookies, null, 2));
console.log(`Signed in as ${email} → landed on ${landed}; ${cookies.length} cookie(s) saved to ${out}`);
await browser.close();
