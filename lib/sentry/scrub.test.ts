import { describe, expect, it } from "vitest";
import { isExpectedError, scrubBreadcrumb, scrubEvent, stripQuery } from "./scrub";

describe("isExpectedError", () => {
  it("flags Next.js control-flow digests", () => {
    expect(isExpectedError({ digest: "NEXT_REDIRECT;replace;/login;307;" })).toBe(true);
    expect(isExpectedError({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" })).toBe(true);
    expect(isExpectedError({ digest: "NEXT_NOT_FOUND" })).toBe(true);
  });

  it("flags our expected auth and validation errors by name", () => {
    expect(isExpectedError(Object.assign(new Error("x"), { name: "AuthError" }))).toBe(true);
    expect(isExpectedError(Object.assign(new Error("x"), { name: "ZodError" }))).toBe(true);
  });

  it("does not swallow real bugs", () => {
    expect(isExpectedError(new TypeError("undefined is not a function"))).toBe(false);
    expect(isExpectedError({ digest: "1234567890" })).toBe(false);
    expect(isExpectedError(null)).toBe(false);
    expect(isExpectedError("string")).toBe(false);
  });
});

describe("stripQuery", () => {
  it("drops query and fragment, keeps origin and path", () => {
    expect(stripQuery("https://app.example.com/api/auth/callback?code=abc&next=/x#f")).toBe(
      "https://app.example.com/api/auth/callback",
    );
    expect(stripQuery("/login?next=/dashboard")).toBe("/login");
  });
});

describe("scrubEvent", () => {
  const dirty = {
    message: "otp failed for +14015551234",
    exception: { values: [{ type: "Error", value: "no account for kid@example.com" }] },
    request: {
      url: "https://app.example.com/login?next=/dashboard&code=SECRET",
      headers: { cookie: "sb-access-token=abc", authorization: "Bearer xyz" },
      cookies: { sb: "abc" },
      data: { password: "hunter2" },
      query_string: "code=SECRET",
      method: "POST",
    },
    user: { id: "u-1", email: "kid@example.com", username: "kid", ip_address: "203.0.113.7" },
    extra: { password: "hunter2", note: "ok", who: "kid@example.com" },
    contexts: { runtime: { name: "node" }, auth: { accessToken: "abc" } },
    breadcrumbs: [
      { category: "console", message: "hello kid@example.com" },
      { category: "ui.click", message: "button.text-red > Kid Name" },
      { category: "fetch", data: { url: "https://x.co/api?code=SECRET", method: "GET" } },
    ],
    server_name: "ip-10-0-0-1.internal",
  };

  it("removes every kind of sensitive payload", () => {
    const out = scrubEvent(dirty);
    const json = JSON.stringify(out);
    for (const leaked of [
      "hunter2",
      "SECRET",
      "kid@example.com",
      "+14015551234",
      "203.0.113.7",
      "sb-access-token",
      "Bearer xyz",
      "ip-10-0-0-1",
      "Kid Name",
    ]) {
      expect(json).not.toContain(leaked);
    }
  });

  it("keeps what is useful for debugging", () => {
    const out = scrubEvent(dirty);
    expect(out.request).toEqual({ url: "https://app.example.com/login" });
    expect(out.user).toEqual({ id: "u-1" });
    expect(out.exception?.values?.[0].type).toBe("Error");
    expect(out.exception?.values?.[0].value).toBe("no account for [email]");
    expect(out.extra?.note).toBe("ok");
    expect(out.contexts?.runtime).toEqual({ name: "node" });
    expect(out.breadcrumbs).toEqual([
      { category: "fetch", data: { url: "https://x.co/api", method: "GET" } },
    ]);
  });

  it("drops the user entirely when there is no id", () => {
    expect(scrubEvent({ user: { email: "a@b.co" } }).user).toBeUndefined();
  });

  it("does not mutate the original event", () => {
    const original = JSON.stringify(dirty);
    scrubEvent(dirty);
    expect(JSON.stringify(dirty)).toBe(original);
  });
});

describe("scrubBreadcrumb", () => {
  it("drops console and UI breadcrumbs", () => {
    expect(scrubBreadcrumb({ category: "console" })).toBeNull();
    expect(scrubBreadcrumb({ category: "ui.input" })).toBeNull();
  });

  it("strips query strings from navigation breadcrumbs", () => {
    expect(scrubBreadcrumb({ category: "navigation", data: { from: "/a?x=1", to: "/b?code=2" } })).toEqual({
      category: "navigation",
      data: { from: "/a", to: "/b" },
    });
  });
});
