// Pure redaction helpers shared by the logger and the Sentry hooks. No Next.js
// or server-only imports so this file can be unit-tested directly.
//
// Policy (some students may be minors): logs and error reports carry opaque
// user ids only. Emails, phone numbers, tokens, cookies and passwords never
// leave the process in a log line or an error report.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\+\d[\d\s().-]{7,}\d/g;
const JWT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

/** Object keys whose values are never emitted, whatever they contain. */
const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|api-?key|otp|jwt|session|phone|email/i;

export const REDACTED = "[redacted]";
const MAX_DEPTH = 5;
const MAX_STRING = 2000;
const STACK_LINES = 8;

/** Mask emails, phone numbers and token-shaped strings inside free text. */
export function scrubString(input: string): string {
  const clipped = input.length > MAX_STRING ? `${input.slice(0, MAX_STRING)}…` : input;
  return clipped
    .replace(JWT, "[jwt]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(EMAIL, "[email]")
    .replace(PHONE, "[phone]");
}

export type SerializedError = {
  name: string;
  message: string;
  code?: string | number;
  status?: number;
  stack?: string;
};

/** Safe, bounded representation of anything that was thrown. */
export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    const withMeta = err as Error & { code?: unknown; status?: unknown };
    const out: SerializedError = { name: err.name, message: scrubString(err.message) };
    if (typeof withMeta.code === "string" || typeof withMeta.code === "number") {
      out.code = withMeta.code;
    }
    if (typeof withMeta.status === "number") out.status = withMeta.status;
    if (err.stack) {
      out.stack = scrubString(err.stack.split("\n").slice(0, STACK_LINES).join("\n"));
    }
    return out;
  }
  return { name: "NonError", message: scrubString(typeof err === "string" ? err : safeToString(err)) };
}

function safeToString(value: unknown): string {
  try {
    return typeof value === "object" ? JSON.stringify(value) ?? String(value) : String(value);
  } catch {
    return "[unserializable]";
  }
}

/**
 * Deep-copy `value` with sensitive keys masked and every string scrubbed.
 * Bounded depth so cyclic or huge objects can't hang or bloat a log line.
 * Never mutates its input.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return serializeError(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return "[unsupported]";
  if (depth >= MAX_DEPTH) return "[truncated]";

  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(inner, depth + 1);
  }
  return out;
}
