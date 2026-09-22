#!/usr/bin/env node
// Run one read-only SQL statement against DATABASE_URL and print rows as JSON.
// Dev helper for audits (e.g. "do the seed users exist?"). Refuses anything
// that isn't a SELECT so it can't be misused for writes.
//
//   pnpm exec dotenv -e .env.local -- node scripts/db-query.mjs "select email, role from public.users where email like '%@example.test'"
import postgres from "postgres";

const q = process.argv.slice(2).join(" ").trim();
if (!/^select\b/i.test(q)) {
  console.error("Only SELECT statements are allowed.");
  process.exit(2);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  const rows = await sql.unsafe(q);
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await sql.end();
}
