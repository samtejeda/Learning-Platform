/**
 * Public site origin used to build auth email links (confirmation, password
 * reset). Resolution order: explicit NEXT_PUBLIC_SITE_URL → Vercel's
 * deployment URL → localhost. In real production an explicit value is
 * required so links never point at a preview host or localhost.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return stripTrailingSlash(explicit);

  if (isRealProduction()) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be set in production");
  }
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${stripTrailingSlash(vercel)}`;
  return "http://localhost:3000";
}

/**
 * NODE_ENV is "production" for every Vercel build, preview deployments
 * included, so it can't tell a real production deploy from a preview one.
 * VERCEL_ENV can: Vercel sets it to "production" only for the production
 * deployment, and "preview"/"development" otherwise (where VERCEL_URL is a
 * correct, unique-per-deployment fallback). Off Vercel entirely (self-hosted
 * per the template goal), VERCEL_ENV is unset and NODE_ENV is the only signal.
 */
function isRealProduction(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv) return vercelEnv === "production";
  return process.env.NODE_ENV === "production";
}

/**
 * Supabase service-role key. Server-only and used EXCLUSIVELY by
 * lib/storage (signed URLs, object checks, deletes) — never for database
 * queries, which go through Drizzle so app-layer authorization always
 * applies. Must never be exposed with a NEXT_PUBLIC_ prefix.
 */
export function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set (used for Storage signed URLs only)");
  }
  return key;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
