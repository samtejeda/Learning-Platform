import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

/**
 * Uniform JSON error shape for route handlers:
 *   { error: { code: "forbidden", message: "Not allowed" } }
 * `code` is a stable machine-readable slug; `message` is safe to show users.
 * Never include stack traces, SQL, or internal identifiers.
 */
export function jsonError(status: number, code: string, message?: string) {
  return NextResponse.json(
    { error: { code, message: message ?? defaultMessage(code) } },
    { status },
  );
}

function defaultMessage(code: string): string {
  switch (code) {
    case "unauthenticated":
      return "Please sign in.";
    case "forbidden":
      return "You don't have access to that.";
    case "not_found":
      return "Not found.";
    case "invalid_input":
      return "Some of the submitted data is invalid.";
    case "rate_limited":
      return "Too many requests. Please try again later.";
    default:
      return "Something went wrong.";
  }
}

/**
 * Defence-in-depth CSRF check for state-changing route handlers. Our
 * session cookie is SameSite=Lax and JSON bodies already force a CORS
 * preflight, but a request that carries an Origin/Referer from another
 * site is rejected outright. Requests without either header (same-origin
 * fetch in some browsers, curl) pass through to the auth check.
 */
export function isSameOrigin(request: Request): boolean {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expected;
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Catch-all for route handlers. Known error types map to the right status;
 * anything else is logged server-side and returned as a generic 500.
 */
export function handleRouteError(err: unknown) {
  if (err instanceof AuthError) {
    return err.kind === "unauthenticated"
      ? jsonError(401, "unauthenticated")
      : jsonError(403, "forbidden");
  }
  if (err instanceof ZodError) {
    return jsonError(400, "invalid_input");
  }
  logger.error("api.unhandled_error", { err });
  return jsonError(500, "internal_error");
}
