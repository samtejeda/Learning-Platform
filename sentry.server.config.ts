import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions } from "@/lib/sentry/options";

// Node.js runtime (Next 16's proxy.ts also runs on Node). Loaded from
// instrumentation.ts. A no-op unless NEXT_PUBLIC_SENTRY_DSN is set.
Sentry.init({
  ...sharedSentryOptions,
  // Same-named integration replaces the default; this one stops every request
  // being reported as a release-health session, which we don't use.
  integrations: [Sentry.httpIntegration({ trackIncomingRequestsAsSessions: false })],
});
