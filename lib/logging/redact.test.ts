import { describe, expect, it } from "vitest";
import { REDACTED, redact, scrubString, serializeError } from "./redact";
import { buildLogLine } from "./format";

describe("scrubString", () => {
  it("masks emails", () => {
    expect(scrubString("failed for kid@example.com today")).toBe("failed for [email] today");
  });

  it("masks E.164 and formatted phone numbers", () => {
    expect(scrubString("otp to +14015551234 failed")).toBe("otp to [phone] failed");
    expect(scrubString("call +1 (401) 555-1234 now")).toBe("call [phone] now");
  });

  it("masks JWTs and bearer tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abc_DEF-123";
    expect(scrubString(`token ${jwt} rejected`)).toBe("token [jwt] rejected");
    expect(scrubString("Authorization: Bearer abc.def-123")).toBe("Authorization: Bearer [redacted]");
  });

  it("leaves ordinary text and timestamps alone", () => {
    const s = "code exchange failed at 2026-09-18T15:35:25Z after 3 retries";
    expect(scrubString(s)).toBe(s);
  });

  it("clips very long strings", () => {
    expect(scrubString("a".repeat(5000)).length).toBeLessThan(2100);
  });
});

describe("redact", () => {
  it("masks sensitive keys at any depth", () => {
    const out = redact({
      userId: "u1",
      password: "hunter2",
      nested: { accessToken: "abc", Cookie: "sb=1", phone: "+14015551234", ok: "yes" },
    }) as Record<string, unknown>;
    expect(out.userId).toBe("u1");
    expect(out.password).toBe(REDACTED);
    expect(out.nested).toEqual({
      accessToken: REDACTED,
      Cookie: REDACTED,
      phone: REDACTED,
      ok: "yes",
    });
  });

  it("scrubs strings inside arrays and objects", () => {
    expect(redact({ msgs: ["hi a@b.co"] })).toEqual({ msgs: ["hi [email]"] });
  });

  it("does not mutate its input", () => {
    const input = { password: "x", nested: { email: "a@b.co" } };
    redact(input);
    expect(input).toEqual({ password: "x", nested: { email: "a@b.co" } });
  });

  it("survives cycles by truncating", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => redact(a)).not.toThrow();
  });
});

describe("serializeError", () => {
  it("keeps name, code and status, scrubs the message, bounds the stack", () => {
    const err = Object.assign(new Error("no user kid@example.com"), { code: "over_limit", status: 429 });
    const s = serializeError(err);
    expect(s.name).toBe("Error");
    expect(s.message).toBe("no user [email]");
    expect(s.code).toBe("over_limit");
    expect(s.status).toBe(429);
    expect(s.stack!.split("\n").length).toBeLessThanOrEqual(8);
  });

  it("surfaces one scrubbed level of cause (driver error under a wrapper)", () => {
    const inner = Object.assign(new Error("connect ECONNREFUSED for kid@example.com"), { code: "ECONNREFUSED" });
    const s = serializeError(new Error("Failed query: select 1", { cause: inner }));
    expect(s.cause).toEqual({
      name: "Error",
      message: "connect ECONNREFUSED for [email]",
      code: "ECONNREFUSED",
    });
  });

  it("handles non-Error throws", () => {
    expect(serializeError("boom +14015551234").message).toBe("boom [phone]");
    expect(serializeError({ a: 1 }).message).toBe('{"a":1}');
  });
});

describe("buildLogLine", () => {
  const now = new Date("2026-09-18T12:00:00.000Z");

  it("emits one JSON line with the standard fields", () => {
    const line = buildLogLine("error", "auth.code_exchange_failed", { userId: "u1", scope: "callback" }, now);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      ts: "2026-09-18T12:00:00.000Z",
      level: "error",
      event: "auth.code_exchange_failed",
      userId: "u1",
      scope: "callback",
    });
  });

  it("does not let caller fields override reserved keys", () => {
    const parsed = JSON.parse(buildLogLine("info", "real", { level: "fake", event: "fake", ts: "fake" }, now));
    expect(parsed.level).toBe("info");
    expect(parsed.event).toBe("real");
    expect(parsed.ts).toBe("2026-09-18T12:00:00.000Z");
  });

  it("never leaks secrets from fields or errors", () => {
    const line = buildLogLine(
      "error",
      "x",
      { password: "hunter2", email: "kid@example.com", err: new Error("bad +14015551234") },
      now,
    );
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("kid@example.com");
    expect(line).not.toContain("+14015551234");
  });
});
