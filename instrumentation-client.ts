import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions } from "@/lib/sentry/options";

// Browser SDK. A no-op unless NEXT_PUBLIC_SENTRY_DSN is set. No Replay, no
// tracing (see lib/sentry/options.ts).
Sentry.init(sharedSentryOptions);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
