import "server-only";

import { buildLogLine, type LogFields, type LogLevel } from "@/lib/logging/format";

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
 *
 * Vercel already correlates each line with its request id, so no request id
 * is added here (reading headers() would make every log call async).
 */
function write(level: LogLevel, event: string, fields?: LogFields) {
  const line = buildLogLine(level, event, fields);
  // eslint-disable-next-line no-console -- the one sanctioned console call site
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(line);
}

export const logger = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
