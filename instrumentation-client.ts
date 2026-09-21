import { loadSentry } from "@/lib/sentry/client";

// Browser error tracking, loaded AFTER the page is idle so it stays off the
// critical path (see lib/sentry/client.ts for the measurements). A no-op unless
// NEXT_PUBLIC_SENTRY_DSN is set. No Replay, no tracing (lib/sentry/options.ts).
const start = () => void loadSentry();

// Sentry's build plugin warns when this hook is missing. It only feeds
// navigation tracing, which is off, and importing Sentry's own implementation
// would put the whole SDK back into the initial bundle. A no-op satisfies the
// check at no cost.
export function onRouterTransitionStart() {}

const afterLoad = () => {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(start, { timeout: 4000 });
  } else {
    window.setTimeout(start, 1); // Safari
  }
};

if (document.readyState === "complete") afterLoad();
else window.addEventListener("load", afterLoad, { once: true });
