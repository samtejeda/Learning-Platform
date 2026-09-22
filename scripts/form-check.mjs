#!/usr/bin/env node
// Audit helper for "Do forms show clear error messages and keep user input on
// failed submissions?" — submits the register form with mismatched passwords
// and an invalid email, then checks the error copy and retained values.
//
//   BASE_URL=http://localhost:3100 pnpm form-check
import { chromium } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures++;
};

await page.goto(new URL("/register", BASE_URL).toString(), { waitUntil: "networkidle" });
await page.fill("#fullName", "Test Person");
await page.fill("#email", "not-an-email");
await page.fill("#password", "password123");
await page.fill("#confirmPassword", "different123");
await page.click("button[type=submit]");
// Wait for the server action to finish (SubmitButton sets aria-busy while
// pending). Don't wait on [role=alert]: Next's route announcer is one.
await page.waitForSelector("button[type=submit][aria-busy=true]", { timeout: 5000 }).catch(() => {});
await page.waitForSelector("button[type=submit]:not([aria-busy=true])", { timeout: 30000 });
await page.waitForSelector("#email-error, #confirmPassword-error", { timeout: 5000 }).catch(() => {});

check(await page.locator("#email-error").isVisible(), "email field shows its own error");
check(
  await page.locator("#confirmPassword-error").isVisible(),
  "confirm-password field shows its own error",
);
check((await page.inputValue("#fullName")) === "Test Person", "full name retained after failed submit");
check((await page.inputValue("#email")) === "not-an-email", "email retained after failed submit");
check((await page.inputValue("#password")) === "", "password NOT echoed back (secret)");
check(
  (await page.getAttribute("#email", "aria-invalid")) === "true",
  "invalid input is marked aria-invalid",
);
check(
  (await page.getAttribute("#email", "aria-describedby")) === "email-error",
  "error text is linked via aria-describedby",
);

await page.screenshot({ path: process.env.OUT ?? ".screenshots/form-check-register.png", fullPage: true });
await browser.close();
if (failures) process.exit(1);
