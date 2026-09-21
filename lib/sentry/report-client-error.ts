import * as Sentry from "@sentry/nextjs";

/**
 * Report an error caught by a React error boundary (`error.tsx`,
 * `global-error.tsx`). React swallows these before Sentry's global handlers
 * see them, so boundaries must call this themselves.
 *
 * Errors carrying a `digest` were thrown on the server and were already
 * captured there by `onRequestError` with the real stack; the copy the
 * browser receives is redacted by Next and would only create a useless
 * duplicate issue. Only client-originated errors are reported here.
 */
export function reportClientError(error: Error & { digest?: string }) {
  if (error.digest) return;
  Sentry.captureException(error);
}
