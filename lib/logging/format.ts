import { redact, serializeError } from "./redact";

export type LogLevel = "info" | "warn" | "error";

/**
 * Fields callers may attach to a log line. `userId` is the opaque auth user
 * id, never an email or phone. `err` is anything that was thrown.
 */
export type LogFields = {
  userId?: string;
  err?: unknown;
  [key: string]: unknown;
};

/**
 * Build one single-line JSON log record: { ts, level, event, ...fields }.
 * The reserved keys always win over caller fields, everything is redacted,
 * and serialisation can't throw.
 */
export function buildLogLine(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  now: Date = new Date(),
): string {
  const { err, ...rest } = fields;
  const safeFields = redact(rest) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    ...safeFields,
    ts: now.toISOString(),
    level,
    event,
  };
  if (err !== undefined) record.err = serializeError(err);

  try {
    return JSON.stringify(record);
  } catch {
    return JSON.stringify({ ts: record.ts, level, event, err: "unserializable log record" });
  }
}
