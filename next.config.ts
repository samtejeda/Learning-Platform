import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const isDev = process.env.NODE_ENV !== "production";

// Supabase origin for images/media/API calls (signed Storage URLs, Auth,
// Realtime). Derived from the public env var so preview/prod differ correctly.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : "";
const supabaseWs = supabaseOrigin.replace(/^https?:/, "wss:");

// Sentry's browser SDK posts events straight to its ingest host, taken from
// the DSN (https://<key>@<host>/<project>). Allowing that origin in the CSP
// is what lets us skip a tunnel route, which would be an extra public
// endpoint. Empty (and harmless) when no DSN is configured.
function originOf(value: string | undefined): string {
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}
const sentryOrigin = originOf(process.env.NEXT_PUBLIC_SENTRY_DSN);

// Content-Security-Policy. Shipped as Report-Only first: Next.js inlines
// scripts and styles, so an enforced policy without per-request nonces would
// break hydration. Enforce (and add nonces via proxy.ts) in the hardening
// phase once the video player's origins are settled.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabaseOrigin}`.trim(),
  `media-src 'self' blob: ${supabaseOrigin}`.trim(),
  `connect-src 'self' ${supabaseOrigin} ${supabaseWs} ${sentryOrigin}`.trim(),
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  // Two years, subdomains, preload-list eligible. Only meaningful over HTTPS
  // (Vercel), harmless on localhost.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)",
  },
  { key: "Content-Security-Policy-Report-Only", value: csp },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

// Source maps: uploaded privately to Sentry at build time and then deleted
// from the build output, so readable stack traces exist in Sentry only and
// nothing is served to the public. Upload needs SENTRY_AUTH_TOKEN (+ org and
// project); without them the build still succeeds and simply skips upload.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Don't phone Sentry with build-tooling usage stats.
  telemetry: false,
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});
