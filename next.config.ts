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

// Every route under these prefixes renders per-user data behind a session.
// Next already marks dynamic responses no-store; stating it here too means a
// future static/`revalidate` slip can't get one student's page cached by a CDN
// or shared proxy and served to another.
const AUTHENTICATED_PREFIXES = ["/dashboard", "/courses", "/professor", "/admin"];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    // Modern formats first; the optimizer falls back per Accept header. No
    // remotePatterns on purpose: Supabase signed URLs are unique per request,
    // so optimizing them would never hit the cache and just bills
    // transformations. Video/thumbnails come straight from Storage.
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // Un-hashed static files from /public. A day fresh, a week stale-while-
      // revalidate: a changed icon shows up within a day, and nothing waits on
      // a revalidation. `_next/` is excluded: Next serves hashed build assets
      // there as `immutable, max-age=1y` and this must not weaken that.
      {
        source: "/((?!_next/).*\\.(?:svg|ico|png|jpg|jpeg|gif|webp|avif))",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
      ...AUTHENTICATED_PREFIXES.map((prefix) => ({
        source: `${prefix}/:path*`,
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      })),
    ];
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
