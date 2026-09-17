import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

function createClient() {
  return postgres(connectionString!, {
    // Use a single connection in development to avoid exhausting the pool,
    // and a pooled connection in production (Supabase transaction pooler).
    max: process.env.NODE_ENV === "production" ? 10 : 1,
    // Disable prefetch for compatibility with Supabase's pgBouncer in transaction mode
    prepare: false,
  });
}

// Cache the client across HMR reloads in development. Without this every
// hot reload opens a new connection and, with max: 1, requests hang.
const globalForDb = globalThis as unknown as {
  __pgClient?: ReturnType<typeof createClient>;
};

const client =
  process.env.NODE_ENV === "production"
    ? createClient()
    : (globalForDb.__pgClient ??= createClient());

export const db = drizzle(client, { schema });
