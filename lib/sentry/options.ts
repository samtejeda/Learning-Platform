import type { Breadcrumb, ErrorEvent, EventHint } from "@sentry/nextjs";
import { isExpectedError, scrubBreadcrumb, scrubEvent } from "./scrub";

/**
 * Init options shared by the browser and Node SDKs.
 *
 * Deliberate omissions, for privacy and bundle size:
 *  - no `tracesSampleRate`: tracing stays fully disabled (0 would keep it on
 *    and just sample nothing)
 *  - no Replay or Feedback integrations
 *  - `sendDefaultPii: false`: no IPs, cookies or headers from the SDK
 *  - no release-health "session" pings and no client reports: telemetry we
 *    don't use, and on the browser an extra request per page view on a phone
 *    (sessions are switched off per SDK: client.ts and sentry.server.config.ts)
 *  - no tunnel route: it would be one more unauthenticated endpoint. The
 *    ingest origin is allowed in the CSP instead (next.config.ts).
 *
 * With no DSN configured (local dev, CI) `enabled` is false and every Sentry
 * call in the app is a no-op.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

/** Browser only: drop the release-health "session" ping sent on every page view. */
export function withoutBrowserSession<T extends { name: string }>(defaults: T[]): T[] {
  return defaults.filter((integration) => integration.name !== "BrowserSession");
}

export const sharedSentryOptions = {
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  sendClientReports: false,
  beforeSend(event: ErrorEvent, hint: EventHint): ErrorEvent | null {
    if (isExpectedError(hint?.originalException)) return null;
    return scrubEvent(event);
  },
  beforeBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
    return scrubBreadcrumb(crumb);
  },
};
