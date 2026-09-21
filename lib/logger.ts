import "server-only";

import * as Sentry from "@sentry/nextjs";
import { buildLogLine, type LogFields, type LogLevel } from "@/lib/logging/format";
import { redact } from "@/lib/logging/redact";

/**
 * Structured server logger. Every call writes exactly one JSON line to
 * stdout/stderr, which Vercel indexes by field:
 *
 *   {"ts":"…","level":"error","event":"auth.code_exchange_failed","userId":"…"}
 *
 * Conventions:
 *  - `event` is a stable dotted slug (`area.what_happened`), never a sentence.
 *  - Attach the acting user as `userId` (opaque auth id). Never log emails,
 *    phone numbers, IPs, tokens or form values; redaction is a backstop, not
 *    permission to try.
 *  - Pass anything thrown as `err`; it is serialised, scrubbed and bounded.
 *  - `error` level is also sent to Sentry. Use it for things that need a
 *    human to look; use `warn` for expected-but-notable events (failed
 *    sign-ins, rate limiting, a dependency check failing).
 *
 * Vercel already correlates each line with its request id, so no request id
 * is added here (reading headers() would make every log call async).
 */
function write(level: LogLevel, event: string, fields?: LogFields) {
  const line = buildLogLine(level, event, fields);
  // eslint-disable-next-line no-console -- the one sanctioned console call site
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(line);

  if (level === "error") reportToSentry(event, fields);
}

/**
 * Errors thrown and left uncaught reach Sentry through `onRequestError`.
 * Errors we catch, log and turn into a response never do, so this is their
 * path. A no-op when Sentry isn't configured; it can never throw into a
 * request. Fields are redacted here and scrubbed again in `beforeSend`.
 */
function reportToSentry(event: string, fields?: LogFields) {
  try {
    const { err, ...rest } = fields ?? {};
    const extra = redact(rest) as Record<string, unknown>;
    if (err !== undefined) {
      Sentry.captureException(err, { tags: { event }, extra });
    } else {
      Sentry.captureMessage(event, { level: "error", tags: { event }, extra });
    }
  } catch {
    // Reporting must never break the request that is already failing.
  }
}

export const logger = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
