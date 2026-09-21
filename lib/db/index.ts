import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { logger } from "@/lib/logger";
import * as schema from "./schema";
import { isTransactionPoolerUrl, POOL_TIMEOUTS, resolvePoolMax } from "./pool-config";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const isProd = process.env.NODE_ENV === "production";

// Runtime traffic must go through the transaction pooler (port 6543). A direct
// or session-mode URL works, but each serverless instance then holds real
// Postgres connections and a traffic spike exhausts the database, not just the
// pooler. Warn (don't throw: it would take the site down over a config nit).
if (isProd && !isTransactionPoolerUrl(connectionString)) {
  logger.warn("db.not_transaction_pooler", {
    hint: "DATABASE_URL should use the Supabase transaction pooler (port 6543)",
  });
}

function createClient() {
  return postgres(connectionString!, {
    // Per-instance pool size; see lib/db/pool-config.ts for the reasoning.
    max: resolvePoolMax(process.env.DB_POOL_MAX, isProd),
    // Disable prefetch for compatibility with Supabase's pgBouncer in transaction mode
    prepare: false,
    ...POOL_TIMEOUTS,
  });
}

// Cache the client across HMR reloads in development. Without this every
// hot reload opens a new connection and, with max: 1, requests hang.
const globalForDb = globalThis as unknown as {
  __pgClient?: ReturnType<typeof createClient>;
};

const client = isProd ? createClient() : (globalForDb.__pgClient ??= createClient());

export const db = drizzle(client, { schema });
