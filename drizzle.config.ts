import type { Config } from "drizzle-kit";

// drizzle-kit only (generate / migrate / check / studio). Prefer DIRECT_URL
// (Supabase session pooler, port 5432): DDL and function bodies are safer
// over a session-mode connection than the transaction pooler the app uses.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("DIRECT_URL or DATABASE_URL must be set for drizzle-kit");
}

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
  migrations: {
    table: "__drizzle_migrations",
    schema: "drizzle",
  },
  // Supabase manages its own roles (anon, authenticated, service_role, …);
  // tell drizzle-kit not to try to diff or drop them.
  entities: {
    roles: { provider: "supabase" },
  },
} satisfies Config;
