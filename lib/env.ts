/**
 * Public site origin used to build auth email links (confirmation, password
 * reset). Resolution order: explicit NEXT_PUBLIC_SITE_URL → Vercel's
 * deployment URL → localhost. In production an explicit value is required so
 * links never point at a preview host or localhost.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return stripTrailingSlash(explicit);

  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_SITE_URL must be set in production");
  }
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${stripTrailingSlash(vercel)}`;
  return "http://localhost:3000";
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
