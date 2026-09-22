import { sharedSentryOptions, withoutBrowserSession } from "./options";

type SentryModule = typeof import("./browser-sdk");

let loading: Promise<SentryModule | null> | undefined;

/**
 * Load and initialise the browser SDK on first use, exactly once.
 *
 * Why lazy: measured on a production build, the browser SDK adds ~57 KiB
 * gzipped to the initial JS and costs roughly +0.8 s LCP / +150 ms blocking
 * time on mobile Lighthouse. This app's audience is phones, so the SDK is
 * loaded after the page is idle (instrumentation-client.ts) or on demand
 * when an error boundary needs it, never on the critical path.
 *
 * Trade-off: errors thrown in the first moments after load, before the SDK
 * starts, are not captured. Server-side errors are unaffected.
 *
 * Resolves to null (and never downloads the SDK chunk) when no DSN is set.
 */
export function loadSentry(): Promise<SentryModule | null> {
  if (!sharedSentryOptions.enabled) return Promise.resolve(null);
  loading ??= import("./browser-sdk")
    .then((Sentry) => {
      if (!Sentry.getClient()) {
        Sentry.init({
          ...sharedSentryOptions,
          // No release-health session ping per page view.
          integrations: withoutBrowserSession,
        });
      }
      return Sentry;
    })
    .catch(() => null); // Error reporting must never break the page.
  return loading;
}
