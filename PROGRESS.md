# Progress

Source of truth for where this project actually stands. Read this before resuming work in a new session — trust this over assumptions in `CLAUDE.md`'s narrative sections, since code moves faster than docs.

Last reconciled: 2026-09-17 (full file-by-file inventory; foundation phase plan approved by Sam and in progress).

## Foundation phase (2026-09-17) — commit log
- [x] 1. `proxy.ts` exported `middleware` and `runtime`; Next 16 requires a `proxy` export and forbids segment config in that file, so the auth gate never ran and `pnpm build` failed. Fixed. `drizzle/meta/` un-ignored so migrations can be versioned. `DIRECT_URL` added to `.env.local.example`.
- [x] 2. Versioned migrations: `drizzle/0000_init.sql` + `drizzle/meta/` committed; `db:push` removed; `db:check` added; `drizzle.config.ts` uses `DIRECT_URL`. **Not yet applied** (DB unreachable). When it's back: if the DB is empty run `pnpm db:migrate`. If the schema already exists from an old `db:push` and holds no real data, baseline first: `CREATE SCHEMA IF NOT EXISTS drizzle; CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint); INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('<sha256 of drizzle/0000_init.sql>', <"when" from drizzle/meta/_journal.json entry 0>);` then `pnpm db:migrate`. If it holds real student data, stop and ask Sam.
- [x] 3. Deny-all RLS: `.enableRLS()` on all 13 tables (`drizzle/0001_enable_rls.sql`) + `drizzle/0002_revoke_postgrest_grants.sql` revoking anon/authenticated grants and default privileges. Not yet applied (DB unreachable). Verify after migrate: `curl -i "$SUPABASE_URL/rest/v1/users?select=id&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"` must return 401/403 with `42501`, not `200 []`.
- [x] 4. `drizzle/0003_auth_user_triggers.sql`: `handle_new_auth_user` (profile row, role student), `sync_auth_user_contact`, `sync_user_role_claim` (role → `auth.users.raw_app_meta_data.role`), plus a backfill. `signUp` no longer inserts into `users`; it passes `full_name` via user metadata. Not yet applied. **To promote a professor for now:** `update public.users set role = 'professor' where email = '…';` — the trigger syncs the JWT claim, and the user must sign out/in (or wait for the next token refresh) for the proxy's coarse gate to see it. Server-side `requireRole` reads the DB and is immediate.
- [x] 5. Vitest (`pnpm test`, 12 tests); `lib/auth/roles.ts` (pure path/role helpers incl. `safeNextPath` open-redirect guard), `lib/auth/session.ts` (`getCurrentUser` cached, `requireUser`/`requireRole` redirect for pages, `assertUser`/`assertRole` throw for actions/handlers), `lib/api/respond.ts` (uniform JSON errors, `AuthError`→401/403, `ZodError`→400). zod added.
- [x] 6. Role-prefixed URLs (student at root, `/professor/*`, `/admin/*`); proxy reads role from the verified JWT (`getClaims`) and bounces by prefix; per-group layouts call `requireUser`/`requireRole`; `components/ui/*`, `app-shell`, `sign-out-button`; `lib/data/courses.ts` (permission encoded in each query); `/` redirects by role; student dashboard + course page; professor dashboard + course page (admin sees all); admin placeholder. Empty placeholder dirs removed. `CLAUDE.md` structure rewritten around the three-gate model.
- [x] 7. `lib/validation/auth.ts` (email/password/E.164 phone/OTP/name schemas + form schemas), `lib/validation/form.ts` (`ActionState`, `parseFormData`/`parseObject`; secrets never echoed back). All auth actions validate first and return generic messages ("Invalid email or password.", "Invalid or expired code."; sign-up never reveals whether an email exists). Auth pages rewritten to React 19 `useActionState` with per-field errors; login honours `?next=` via `safeNextPath`. Phone OTP now `shouldCreateUser: false` (Sam's decision 2026-09-17).
- [x] 8. `GET /api/auth/callback` exchanges the PKCE code from email links for a session and redirects to a sanitised `next`; `/update-password` page + `updatePassword` action (requires the recovery session; re-checked server-side); `lib/env.ts` `getSiteUrl()` (throws in production if `NEXT_PUBLIC_SITE_URL` is unset); sign-up and reset emails now point at the callback. **Sam:** add `<site>/api/auth/callback` to Supabase Auth → URL Configuration → Redirect URLs for localhost and prod, and set Site URL.
- [x] 9. `rate_limit_buckets` table (`drizzle/0004`), `lib/rate-limit/` (atomic fixed-window upsert, fails closed on DB error; pure policy in `policy.ts` with tests). Applied per IP and per identifier to sign-in, sign-up, OTP send, OTP verify, and reset request, before any Supabase call. Starting limits in `RATE_LIMITS`: login 10/15m IP + 5/15m email; signup 5/h IP + 3/h email; OTP send 10/h IP + 3/h phone; OTP verify 20/10m IP + 5/10m phone; reset 10/h IP + 3/h email. Supabase Auth's own limits remain as a second layer. Migration not yet applied.
- [x] 10. `next.config.ts`: `poweredByHeader: false`; HSTS (2y, preload), nosniff, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy, and a CSP in **Report-Only** mode (Next inlines scripts; enforce with nonces in the hardening phase). Verified with `curl -I` against `next start`.
- [ ] 11. `API.md` inventory, docs refresh.

**Blocked on Sam:** the Supabase project host (`eexfdauqvymkeatjujoo.supabase.co`) does not resolve in DNS as of 2026-09-17 — paused or deleted. Migrations can be generated offline, but applying them (steps 2–4, 9) and live verification wait on restoring/recreating the project. Also `.env.local` needs: the `@` in the `DATABASE_URL` password percent-encoded as `%40`, plus `DIRECT_URL` and `NEXT_PUBLIC_SITE_URL` added.

## Done
- Drizzle schema (`lib/db/schema.ts`) covering users, courses, enrollments, lectures, lecture_progress, exams, exam_questions, exam_submissions, exam_answers, assignments, assignment_submissions, forum_posts, forum_replies, with relations wired up.
- Supabase client helpers (`lib/supabase/client.ts`, `lib/supabase/server.ts`).
- Auth server actions (`lib/auth/actions.ts`): email+password sign-in, phone OTP send/verify, sign-up (creates matching row in `users` with role `student`), password reset request, sign-out.
- Auth pages: `app/(auth)/login`, `register`, `reset-password` (+ layout). Real forms wired to the server actions.
- Authentication gate in `proxy.ts` (Next.js 16's renamed `middleware.ts`): redirects unauthenticated users to `/login?next=…` for any non-public route. Fixed 2026-09-17 (see commit log above); before that the file never ran.

## In progress
- Foundation phase per the commit log above. Inventory on 2026-09-17 confirmed: `app/(student)`, `app/(professor)`, `app/(admin)`, `app/api/*`, and `components/*` were all **empty directories** (no files), and `app/page.tsx` was the stock create-next-app template. Nothing beyond the auth pages was built.

## Next up
(Priority order per `ORCHESTRATION.md`)
1. Data models — schema exists; confirm it's pushed to Supabase (`pnpm db:push`) and add any RLS policies (currently none known to exist — this is a gap given Supabase Postgres is the DB).
2. Auth + roles — add role-based gating in `proxy.ts` and confirm every API route re-checks role/ownership server-side (per API Security Rules in `CLAUDE.md`; not yet audited).
3. Rate limiting on auth endpoints (login, OTP send, OTP verify) — not implemented yet. This is a non-negotiable per `CLAUDE.md` and currently a real gap: `sendPhoneOTP`/`verifyPhoneOTP`/`signInWithEmail` have no throttling.
4. Core CRUD for courses/lectures/exams/assignments.
5. Forum.
6. Design pass once `DESIGN.md` exists (see `ORCHESTRATION.md`) — hold UI polish until then rather than styling twice.

## Decisions & assumptions
- This deployment is for a Bible academy, but the codebase, naming, and schema stay generic/institution-agnostic so it can be reused as a template later — see "Current deployment context" in `CLAUDE.md`. Confirmed by Sam 2026-09-16.
- The 13 `audit-prompts/*.md` files are pass/fail audit checklists, **not build instructions** (confirmed by Sam 2026-09-16). Build agents pull actual work items from this file's "Next up" and from `CLAUDE.md`, build them, then score their own work against the relevant checklist(s) before committing.
- Audit checklists must be **re-read from the file and re-run regularly**, not read once and relied on from memory — each build agent's definition says to re-read its file(s) fresh before every self-check, and to re-run the full checklist after every chunk of work in its domain, not just the first time it touches that domain.
- Build agents (`.claude/agents/*.md`) are active as of 2026-09-16 — all 13 audit-prompt files now have real content.

## Open questions for Sam
- RLS policies: none found in the repo. Given Supabase Postgres is the DB of record and some students may be minors, this should be prioritized alongside auth/role work, not deferred to "security polish" — confirm priority.
- The orchestration doc's design-system step (`npx getdesign@latest add claude`) runs a third-party npm package from the registry. Worth a quick look at the package before running it, same as any other new dependency — not blocking, just flagging since it wasn't in the original stack list.
- Admin role scope is still "TBD" per `CLAUDE.md` — needs definition before admin routes are built out.
