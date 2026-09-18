import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const isDev = process.env.NODE_ENV !== "production";

// Supabase origin for images/media/API calls (signed Storage URLs, Auth,
// Realtime). Derived from the public env var so preview/prod differ correctly.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : "";
const supabaseWs = supabaseOrigin.replace(/^https?:/, "wss:");

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
  `connect-src 'self' ${supabaseOrigin} ${supabaseWs}`.trim(),
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
  // Pin the workspace root to this directory. Without it Next walks up looking
  // for lockfiles and, in a git worktree, can pick a parent directory.
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
