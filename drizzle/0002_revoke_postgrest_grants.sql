-- Deny-all access model for the Supabase REST API (PostgREST).
--
-- Every table already has RLS enabled with no policies (0001_enable_rls).
-- That alone makes anon SELECTs return an empty set rather than an error.
-- Revoking the grants is the stronger guarantee: anon/authenticated get
-- "permission denied" and the tables disappear from the PostgREST OpenAPI
-- listing. service_role keeps access; the app never uses it.
--
-- All application data access goes through Drizzle server-side as the
-- table owner (DATABASE_URL), which is not subject to these grants.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint

-- Make future objects safe by default: Supabase's default privileges grant
-- anon/authenticated access to anything the `postgres` role creates in
-- `public`. Remove that so a new table added by a later migration is not
-- exposed before someone remembers to lock it down.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
