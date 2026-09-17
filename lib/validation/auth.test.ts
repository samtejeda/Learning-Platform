import { describe, expect, it } from "vitest";
import {
  emailSchema,
  otpTokenSchema,
  passwordSchema,
  phoneSchema,
  signUpSchema,
} from "./auth";
import { parseFormData } from "./form";

describe("emailSchema", () => {
  it("trims and lowercases", () => {
    expect(emailSchema.parse("  Jane@Example.COM ")).toBe("jane@example.com");
  });
  it("rejects malformed addresses", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
    expect(emailSchema.safeParse("").success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("enforces 8–72 characters", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("longenough").success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(72)).success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(73)).success).toBe(false);
  });
});

describe("phoneSchema", () => {
  it("normalises human formatting to E.164", () => {
    expect(phoneSchema.parse("+1 (555) 123-4567")).toBe("+15551234567");
    expect(phoneSchema.parse(" +44 20 7946 0958 ")).toBe("+442079460958");
  });
  it("requires a country code and digits only", () => {
    expect(phoneSchema.safeParse("5551234567").success).toBe(false);
    expect(phoneSchema.safeParse("+0 555").success).toBe(false);
    expect(phoneSchema.safeParse("+1 555 ABC").success).toBe(false);
    expect(phoneSchema.safeParse("").success).toBe(false);
  });
});

describe("otpTokenSchema", () => {
  it("accepts exactly six digits", () => {
    expect(otpTokenSchema.parse(" 123456 ")).toBe("123456");
    expect(otpTokenSchema.safeParse("12345").success).toBe(false);
    expect(otpTokenSchema.safeParse("12345a").success).toBe(false);
  });
});

describe("parseFormData", () => {
  function form(entries: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
  }

  it("returns typed data on success", () => {
    const result = parseFormData(
      signUpSchema,
      form({
        fullName: " Jane ",
        email: "Jane@Example.com",
        password: "password123",
        confirmPassword: "password123",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.fullName).toBe("Jane");
      expect(result.data.email).toBe("jane@example.com");
    }
  });

  it("maps issues to fields and never echoes secrets", () => {
    const result = parseFormData(
      signUpSchema,
      form({
        fullName: "Jane",
        email: "jane@example.com",
        password: "password123",
        confirmPassword: "different",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state.fieldErrors?.confirmPassword?.[0]).toBe("Passwords do not match.");
      expect(result.state.values).toEqual({ fullName: "Jane", email: "jane@example.com" });
      expect(result.state.values).not.toHaveProperty("password");
      expect(result.state.error).toBeTruthy();
    }
  });

  it("handles missing fields without throwing", () => {
    const result = parseFormData(signUpSchema, form({}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state.fieldErrors?.email?.[0]).toBe("Email is required.");
      expect(result.state.fieldErrors?.fullName?.[0]).toBe("Full name is required.");
    }
  });
});
