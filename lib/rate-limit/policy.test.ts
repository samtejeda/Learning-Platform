import { describe, expect, it } from "vitest";
import {
  bucketKey,
  clientIpFromHeaders,
  evaluate,
  RATE_LIMITS,
  retryMessage,
} from "./policy";

describe("RATE_LIMITS", () => {
  it("covers every auth scope with both dimensions", () => {
    for (const [scope, policy] of Object.entries(RATE_LIMITS)) {
      expect(policy.perIp.limit, scope).toBeGreaterThan(0);
      expect(policy.perIdentifier.limit, scope).toBeGreaterThan(0);
      expect(policy.perIp.windowSeconds, scope).toBeGreaterThan(0);
    }
  });
  it("keeps SMS sends the tightest per identifier", () => {
    expect(RATE_LIMITS.otp_send.perIdentifier.limit).toBeLessThanOrEqual(
      RATE_LIMITS.login.perIdentifier.limit,
    );
  });
});

describe("bucketKey", () => {
  it("namespaces by scope and kind, and caps subject length", () => {
    expect(bucketKey("login", "ip", "203.0.113.9")).toBe("login:ip:203.0.113.9");
    expect(bucketKey("otp_send", "id", "x".repeat(500)).length).toBe("otp_send:id:".length + 200);
  });
});

describe("evaluate", () => {
  const window = { limit: 3, windowSeconds: 600 };
  const start = new Date("2026-01-01T00:00:00Z");

  it("allows up to the limit and reports remaining", () => {
    expect(evaluate(window, 1, start, start)).toEqual({ ok: true, remaining: 2 });
    expect(evaluate(window, 3, start, start)).toEqual({ ok: true, remaining: 0 });
  });

  it("rejects past the limit with time left in the window", () => {
    const now = new Date(start.getTime() + 100_000);
    expect(evaluate(window, 4, start, now)).toEqual({ ok: false, retryAfterSeconds: 500 });
  });

  it("never returns a non-positive retry", () => {
    const now = new Date(start.getTime() + 10_000_000);
    expect(evaluate(window, 99, start, now)).toEqual({ ok: false, retryAfterSeconds: 1 });
  });
});

describe("retryMessage", () => {
  it("phrases the wait sensibly", () => {
    expect(retryMessage(30)).toMatch(/in a minute/);
    expect(retryMessage(300)).toMatch(/5 minutes/);
    expect(retryMessage(3600)).toMatch(/an hour/);
    expect(retryMessage(7500)).toMatch(/3 hours/);
  });
});

describe("clientIpFromHeaders", () => {
  const from = (h: Record<string, string>) => (name: string) => h[name] ?? null;

  it("prefers x-real-ip, then the first x-forwarded-for hop", () => {
    expect(clientIpFromHeaders(from({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIpFromHeaders(from({ "x-forwarded-for": " 3.3.3.3 , 10.0.0.1" }))).toBe("3.3.3.3");
  });
  it("groups header-less callers instead of exempting them", () => {
    expect(clientIpFromHeaders(from({}))).toBe("unknown");
  });
});
