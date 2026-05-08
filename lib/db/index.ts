import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Use a single connection in development to avoid exhausting the pool,
// and a pooled connection string in production (Supabase transaction pooler).
const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, {
  max: process.env.NODE_ENV === "production" ? 10 : 1,
  // Disable prefetch for compatibility with Supabase's pgBouncer in transaction mode
  prepare: false,
});

export const db = drizzle(client, { schema });
