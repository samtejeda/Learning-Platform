// Pure rate-limit policy: no DB, no Next imports. Unit-tested.

export type Window = { limit: number; windowSeconds: number };

export type Policy = {
  /** Per client IP: blunt protection against one machine hammering an endpoint. */
  perIp: Window;
  /** Per identifier (email / phone): protects a specific account from targeting. */
  perIdentifier: Window;
};

export type Scope =
  | "login"
  | "signup"
  | "otp_send"
  | "otp_verify"
  | "reset_request"
  | "resend_confirmation"
  | "invite"
  | "lecture_progress";

const MIN = 60;
const HOUR = 3600;

/**
 * Starting thresholds. Supabase Auth applies its own per-IP/per-hour limits
 * on top of these (dashboard → Auth → Rate Limits), so this layer mainly
 * protects per-account targeting and Twilio spend.
 */
export const RATE_LIMITS: Record<Scope, Policy> = {
  login: {
    perIp: { limit: 10, windowSeconds: 15 * MIN },
    perIdentifier: { limit: 5, windowSeconds: 15 * MIN },
  },
  signup: {
    perIp: { limit: 5, windowSeconds: HOUR },
    perIdentifier: { limit: 3, windowSeconds: HOUR },
  },
  // Every send costs an SMS; keep this the tightest.
  otp_send: {
    perIp: { limit: 10, windowSeconds: HOUR },
    perIdentifier: { limit: 3, windowSeconds: HOUR },
  },
  otp_verify: {
    perIp: { limit: 20, windowSeconds: 10 * MIN },
    perIdentifier: { limit: 5, windowSeconds: 10 * MIN },
  },
  reset_request: {
    perIp: { limit: 10, windowSeconds: HOUR },
    perIdentifier: { limit: 3, windowSeconds: HOUR },
  },
  // Same shape as reset_request: email-targeted, must not leak whether the
  // account exists, so the same conservative limits apply.
  resend_confirmation: {
    perIp: { limit: 10, windowSeconds: HOUR },
    perIdentifier: { limit: 3, windowSeconds: HOUR },
  },
  // Authenticated professor inviting students by email. Identifier is the
  // acting user's id. Generous enough for a cohort, tight enough that the
  // roster can't be used to enumerate accounts at speed.
  invite: {
    perIp: { limit: 60, windowSeconds: HOUR },
    perIdentifier: { limit: 40, windowSeconds: HOUR },
  },
  // Video progress pings: the player sends one every ~10 s of playback plus
  // pause/ended. Identifier is the student's id.
  lecture_progress: {
    perIp: { limit: 300, windowSeconds: MIN },
    perIdentifier: { limit: 60, windowSeconds: MIN },
  },
};

export function bucketKey(scope: Scope, kind: "ip" | "id", subject: string): string {
  // Cap subject length so a hostile header can't bloat the table.
  return `${scope}:${kind}:${subject.slice(0, 200)}`;
}

/**
 * Given the count after this attempt and when the window started, decide
 * whether the attempt is allowed and, if not, how long to wait.
 */
export function evaluate(
  window: Window,
  count: number,
  windowStart: Date,
  now: Date = new Date(),
): { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number } {
  if (count <= window.limit) {
    return { ok: true, remaining: window.limit - count };
  }
  const elapsed = Math.floor((now.getTime() - windowStart.getTime()) / 1000);
  const retryAfterSeconds = Math.max(1, window.windowSeconds - elapsed);
  return { ok: false, retryAfterSeconds };
}

/** User-facing copy for a rejected attempt. */
export function retryMessage(retryAfterSeconds: number): string {
  if (retryAfterSeconds < 90) return "Too many attempts. Please try again in a minute.";
  const minutes = Math.ceil(retryAfterSeconds / 60);
  if (minutes < 60) return `Too many attempts. Please try again in ${minutes} minutes.`;
  const hours = Math.ceil(minutes / 60);
  return `Too many attempts. Please try again in ${hours === 1 ? "an hour" : `${hours} hours`}.`;
}

/**
 * Pick the client IP from proxy headers. Vercel sets x-real-ip to the true
 * client; x-forwarded-for's first hop is the fallback. "unknown" groups
 * header-less callers into one shared bucket rather than exempting them.
 */
export function clientIpFromHeaders(get: (name: string) => string | null): string {
  const real = get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return "unknown";
}
