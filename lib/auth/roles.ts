// Pure role/path helpers. No Next.js or Supabase imports so this file can be
// unit-tested directly and shared by proxy.ts, layouts, and actions.

export const ROLES = ["student", "professor", "admin"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Read the role from verified JWT claims. The `role` key lives in
 * `app_metadata`, which only the server (via the sync_user_role_claim trigger)
 * can write. Returns null if absent or not a known role.
 */
export function roleFromClaims(claims: unknown): Role | null {
  if (!claims || typeof claims !== "object") return null;
  const appMetadata = (claims as { app_metadata?: unknown }).app_metadata;
  if (!appMetadata || typeof appMetadata !== "object") return null;
  const role = (appMetadata as { role?: unknown }).role;
  return isRole(role) ? role : null;
}

/** Landing page for each role after sign-in or when bounced off a forbidden path. */
export function homeForRole(role: Role): "/dashboard" | "/professor" | "/admin" {
  switch (role) {
    case "admin":
      return "/admin";
    case "professor":
      return "/professor";
    default:
      return "/dashboard";
  }
}

const AUTH_ENTRY_PATHS = new Set([
  "/login",
  "/register",
  "/reset-password",
  "/resend-confirmation",
]);

/** Pages a signed-out visitor may load. */
export function isPublicPath(pathname: string): boolean {
  return (
    AUTH_ENTRY_PATHS.has(pathname) ||
    pathname === "/api/auth/callback" ||
    pathname.startsWith("/api/auth/") ||
    // Uptime monitors have no session. The handler returns only ok/degraded.
    pathname === "/api/health"
  );
}

/** Auth pages that make no sense for a signed-in user (bounce them home). */
export function isAuthEntryPath(pathname: string): boolean {
  return AUTH_ENTRY_PATHS.has(pathname);
}

function hasPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/**
 * Coarse, prefix-based role gate used by the proxy. This is a convenience
 * redirect, not the authorization boundary: every layout, page, action, and
 * route handler re-checks role and ownership server-side against the DB.
 *
 *   /professor/*  → professor or admin
 *   /admin/*      → admin
 *   everything else authenticated → any role
 */
export function canAccessPath(pathname: string, role: Role): boolean {
  if (hasPrefix(pathname, "/admin")) return role === "admin";
  if (hasPrefix(pathname, "/professor")) return role === "professor" || role === "admin";
  return true;
}

/**
 * Route-handler paths. A signed-out caller of these gets a JSON 401 from the
 * proxy instead of a redirect to the login page: fetch() follows redirects
 * and would receive HTML with a 200, which clients can't tell from success.
 */
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/**
 * Sanitize a `?next=` redirect target. Only same-origin absolute paths are
 * allowed; anything that could leave the site (scheme, protocol-relative
 * `//host`, backslash tricks, control characters) collapses to "/".
 */
export function safeNextPath(input: string | null | undefined): string {
  if (!input) return "/";
  let value: string;
  try {
    value = decodeURIComponent(input);
  } catch {
    return "/";
  }
  value = value.trim();
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (/[\x00-\x1f\x7f]/.test(value)) return "/";
  if (/^\/[^/]*:/.test(value.split("?")[0].split("#")[0]) && value.includes("://")) return "/";
  // Never bounce back onto an auth-entry page; that just loops.
  const pathOnly = value.split("?")[0].split("#")[0];
  if (isAuthEntryPath(pathOnly)) return "/";
  return value;
}
