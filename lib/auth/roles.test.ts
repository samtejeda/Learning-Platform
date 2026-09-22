import { describe, expect, it } from "vitest";
import {
  canAccessPath,
  homeForRole,
  isApiPath,
  isAuthEntryPath,
  isPublicPath,
  isRole,
  roleFromClaims,
  safeNextPath,
} from "./roles";

describe("isRole / roleFromClaims", () => {
  it("accepts only known roles", () => {
    expect(isRole("student")).toBe(true);
    expect(isRole("professor")).toBe(true);
    expect(isRole("admin")).toBe(true);
    expect(isRole("superuser")).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(1)).toBe(false);
  });

  it("reads role from app_metadata only", () => {
    expect(roleFromClaims({ app_metadata: { role: "professor" } })).toBe("professor");
    // user_metadata is client-writable and must be ignored
    expect(roleFromClaims({ user_metadata: { role: "admin" } })).toBeNull();
    expect(roleFromClaims({ role: "admin" })).toBeNull();
    expect(roleFromClaims({ app_metadata: { role: "root" } })).toBeNull();
    expect(roleFromClaims(null)).toBeNull();
    expect(roleFromClaims("admin")).toBeNull();
  });
});

describe("homeForRole", () => {
  it("maps each role to its landing page", () => {
    expect(homeForRole("student")).toBe("/dashboard");
    expect(homeForRole("professor")).toBe("/professor");
    expect(homeForRole("admin")).toBe("/admin");
  });
});

describe("isPublicPath / isAuthEntryPath", () => {
  it("treats auth pages and the auth API as public", () => {
    for (const p of ["/login", "/register", "/reset-password", "/api/auth/callback"]) {
      expect(isPublicPath(p)).toBe(true);
    }
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/dashboard")).toBe(false);
    expect(isPublicPath("/update-password")).toBe(false); // needs the recovery session
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/api/courses")).toBe(false);
  });

  it("makes only the exact health path public for uptime monitors", () => {
    expect(isPublicPath("/api/health")).toBe(true);
    expect(isPublicPath("/api/healthz")).toBe(false);
    expect(isPublicPath("/api/health/db")).toBe(false);
    expect(isAuthEntryPath("/api/health")).toBe(false);
  });

  it("auth-entry pages exclude the API", () => {
    expect(isAuthEntryPath("/login")).toBe(true);
    expect(isAuthEntryPath("/api/auth/callback")).toBe(false);
  });
});

describe("isApiPath", () => {
  it("matches only the /api tree", () => {
    expect(isApiPath("/api/lectures/x/stream")).toBe(true);
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/apis")).toBe(false);
    expect(isApiPath("/dashboard")).toBe(false);
    expect(isApiPath("/courses/api/x")).toBe(false);
  });
});

describe("canAccessPath", () => {
  it("gates /admin to admins", () => {
    expect(canAccessPath("/admin", "admin")).toBe(true);
    expect(canAccessPath("/admin/users", "admin")).toBe(true);
    expect(canAccessPath("/admin", "professor")).toBe(false);
    expect(canAccessPath("/admin/users", "student")).toBe(false);
  });

  it("gates /professor to professors and admins", () => {
    expect(canAccessPath("/professor", "professor")).toBe(true);
    expect(canAccessPath("/professor/courses/x", "admin")).toBe(true);
    expect(canAccessPath("/professor", "student")).toBe(false);
  });

  it("does not confuse prefixes with similarly named paths", () => {
    expect(canAccessPath("/professors", "student")).toBe(true);
    expect(canAccessPath("/administration", "student")).toBe(true);
  });

  it("lets every role into unprefixed authenticated paths", () => {
    expect(canAccessPath("/dashboard", "student")).toBe(true);
    expect(canAccessPath("/courses/abc", "professor")).toBe(true);
  });
});

describe("safeNextPath", () => {
  it("allows same-origin absolute paths", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/courses/abc?tab=lectures")).toBe("/courses/abc?tab=lectures");
    expect(safeNextPath("%2Fcourses%2Fabc")).toBe("/courses/abc");
  });

  it("rejects anything that could leave the origin", () => {
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath("%2F%2Fevil.example")).toBe("/");
    expect(safeNextPath("/foo\nbar")).toBe("/");
  });

  it("falls back for empty, malformed, or auth-entry targets", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath("%E0%A4%A")).toBe("/");
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath("/register?x=1")).toBe("/");
  });
});
