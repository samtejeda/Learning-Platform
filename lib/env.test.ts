import { afterEach, describe, expect, it } from "vitest";
import { getSiteUrl } from "./env";

const ENV_KEYS = ["NEXT_PUBLIC_SITE_URL", "NODE_ENV", "VERCEL_ENV", "VERCEL_URL"] as const;

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

// NODE_ENV is typed read-only (it's meant to be set once by the runtime),
// so tests that need to simulate it go through a cast rather than the type.
function setNodeEnv(value: string) {
  (process.env as Record<string, string>).NODE_ENV = value;
}

describe("getSiteUrl", () => {
  afterEach(clearEnv);

  it("prefers an explicit NEXT_PUBLIC_SITE_URL in every environment", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com/";
    process.env.VERCEL_ENV = "production";
    expect(getSiteUrl()).toBe("https://example.com");
  });

  it("throws in real Vercel production when unset", () => {
    process.env.VERCEL_ENV = "production";
    expect(() => getSiteUrl()).toThrow(/must be set/);
  });

  it("falls back to VERCEL_URL on a Vercel preview deployment, not throw", () => {
    process.env.VERCEL_ENV = "preview";
    setNodeEnv("production"); // Vercel sets this on every build, previews included
    process.env.VERCEL_URL = "learning-platform-git-feat-x.vercel.app";
    expect(getSiteUrl()).toBe("https://learning-platform-git-feat-x.vercel.app");
  });

  it("falls back to VERCEL_URL in Vercel dev", () => {
    process.env.VERCEL_ENV = "development";
    process.env.VERCEL_URL = "learning-platform-dev.vercel.app";
    expect(getSiteUrl()).toBe("https://learning-platform-dev.vercel.app");
  });

  it("throws for a non-Vercel production build (self-hosted) when unset", () => {
    setNodeEnv("production");
    expect(() => getSiteUrl()).toThrow(/must be set/);
  });

  it("falls back to localhost outside production with nothing else set", () => {
    setNodeEnv("development");
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });
});
