// Pure scrubbing rules for error reports. Structural types only (no Sentry
// runtime import) so the rules are unit-testable and shared by the browser
// and server SDK configs.
//
// Policy (some students may be minors): a report may carry a stack trace, an
// opaque user id and the route path. It must not carry cookies, headers,
// request bodies, query strings (they hold `?code=` and `?next=`), emails,
// phone numbers, IP addresses, hostnames, or the text of what a user
// clicked or typed.

import { redact, scrubString } from "@/lib/logging/redact";

// Only the fields the scrubber reads or rewrites are named; everything else on
// the event passes through untouched. No index signatures, so Sentry's own
// event/breadcrumb interfaces are assignable to these.
type EventLike = {
  message?: string;
  exception?: { values?: { type?: string; value?: string }[] };
  request?: { url?: string };
  // Sentry's User type has its own index signature, so extra fields are legal here.
  user?: { id?: string | number; [k: string]: unknown };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  breadcrumbs?: BreadcrumbLike[];
  server_name?: string;
};

type BreadcrumbLike = {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
};

/** Next.js control-flow digests and our own expected auth/validation errors. */
const EXPECTED_DIGEST = /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK)/;
const EXPECTED_NAMES = new Set(["AuthError", "ZodError"]);

/**
 * True for errors that are normal control flow, not bugs: redirect()/notFound()
 * signals, 401/403 AuthError, and ZodError from bad client input (a 400).
 */
export function isExpectedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { name, digest } = err as { name?: unknown; digest?: unknown };
  if (typeof digest === "string" && EXPECTED_DIGEST.test(digest)) return true;
  return typeof name === "string" && EXPECTED_NAMES.has(name);
}

/** Drop the query string and fragment: they can hold auth codes and `next` targets. */
export function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

export function scrubBreadcrumb<B extends BreadcrumbLike>(crumb: B): B | null {
  // Console output and UI interaction breadcrumbs can contain names, typed
  // text and anything a page rendered. Not worth the exposure.
  if (crumb.category === "console" || crumb.category?.startsWith("ui.")) return null;

  const out: BreadcrumbLike = { ...crumb };
  if (out.message) out.message = scrubString(out.message);
  if (out.data) {
    const data: Record<string, unknown> = { ...out.data };
    for (const key of ["url", "from", "to"]) {
      if (typeof data[key] === "string") data[key] = stripQuery(data[key] as string);
    }
    out.data = redact(data) as Record<string, unknown>;
  }
  return out as B;
}

export function scrubEvent<E extends EventLike>(event: E): E {
  const out: EventLike = { ...event };

  if (out.message) out.message = scrubString(out.message);

  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((v) => ({
        ...v,
        value: typeof v.value === "string" ? scrubString(v.value) : v.value,
      })),
    };
  }

  // Keep only the path. Headers, cookies, body and query string are dropped.
  if (out.request) {
    out.request = out.request.url ? { url: stripQuery(out.request.url) } : {};
  }

  // Opaque id only: no email, username or IP address.
  if (out.user) {
    out.user = out.user.id !== undefined ? { id: out.user.id } : undefined;
  }

  if (out.extra) out.extra = redact(out.extra) as Record<string, unknown>;
  if (out.contexts) {
    // `culture` is the browser's locale + timezone: a coarse location hint we
    // don't need for debugging and don't want for students.
    const contexts = { ...out.contexts };
    delete contexts.culture;
    out.contexts = redact(contexts) as Record<string, unknown>;
  }

  if (out.breadcrumbs) {
    out.breadcrumbs = out.breadcrumbs
      .map((b) => scrubBreadcrumb(b))
      .filter((b): b is BreadcrumbLike => b !== null);
  }

  out.server_name = undefined;
  return out as E;
}
