// The ONLY thing the browser lazy-loads from Sentry. Named re-exports let the
// bundler tree-shake the lazy chunk down to what the app uses. A bare
// `import("@sentry/nextjs")` can't be shaken and shipped ~160 KiB gzipped
// instead of ~57 KiB. Add a name here only when the browser really needs it.
export { init, getClient, captureException } from "@sentry/nextjs";
