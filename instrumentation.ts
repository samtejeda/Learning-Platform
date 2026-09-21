import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

// Captures errors thrown while rendering Server Components, in route handlers
// and in server actions that Next itself sees (errors we catch and turn into a
// response are reported through lib/logger.ts instead). Expected control-flow
// errors are filtered in lib/sentry/options.ts.
export const onRequestError = Sentry.captureRequestError;
