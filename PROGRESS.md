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
- [x] 11. `API.md` (conventions, every route handler + server action with auth/rate-limit/schema/output, env vars, migration list). `CLAUDE.md` updated. Audit self-check below.

**Resolved 2026-09-18:** Supabase project was paused, not deleted — Sam restored it, confirmed no real data was ever in it. `.env.local` fixed (`DATABASE_URL` password percent-encoded, `DIRECT_URL` + `NEXT_PUBLIC_SITE_URL` added). Auth dashboard configured: Site URL, Redirect URLs (`/api/auth/callback`), email confirmations on, min password length 8, all 6 security notification emails enabled (password/email/phone changed, sign-in method linked/removed, MFA added/removed).

Migrations applied. The project had leftover schema objects from an early `db:push` (13 base tables + enum types, matching exactly migration `0000_init`) with no row in `drizzle.__drizzle_migrations` — baselined `0000_init` as already-applied (hash-matched, per the plan in step 2 below) rather than dropping/recreating, then `0001`–`0004` applied cleanly on top. Verified: `pnpm db:migrate` (no-op on rerun), `db:check` (clean), `db:generate` (no changes, 14 tables match `schema.ts` exactly) — steps 1 and part of 2 of the live verification checklist. RLS confirmed **true** on all 14 tables; anon/authenticated grants confirmed **0 rows**; all 3 auth triggers exist. PostgREST directly verified: `GET /rest/v1/users` and `POST /rest/v1/forum_posts` with the anon key both return `401`, `code: 42501` ("permission denied") — deny-all RLS + revoked grants working as designed.

**Still open from the live verification checklist:** steps 4–7 (register → confirm → dashboard flow; rate-limit/reset/OTP behavior; role-based redirect; security headers via `next start`) need the app actually running through real flows — better done by hand or by the next session than scripted here.

## Resilience pass (branch `worktree-academy-resilience`, started 2026-09-21) — commit log
Plan: `~/.claude/plans/pasted-content-id-5c12-rate-limiting-quizzical-waterfall.md`. Decisions from Sam: Sentry free tier, UptimeRobot free, GitHub Actions encrypted nightly backups, Vercel Pro. Rate limiting was already done and is out of scope. Not merged to `main`; stops for Sam's review.
- [x] 1. Structured logging + redaction. `lib/logging/redact.ts` (pure: key-based masking, email/phone/JWT/bearer scrubbing, bounded error serialisation) and `lib/logging/format.ts` (one JSON line: `ts, level, event, …fields`), both unit-tested (14 tests). `lib/logger.ts` is the server wrapper. All 8 `console.*` calls replaced. New security events, scope/code only and never emails, phones or IPs: `auth.sign_in_failed`, `auth.otp_verify_failed`, `auth.rate_limited`, `auth.code_exchange_failed`. ESLint `no-console` is `warn`. *Deviation from plan:* no `requestId` field. `headers()` is async in Next 16, and Vercel already correlates log lines to requests. **Post-merge sweep needed:** code arriving from the backend branch (`lib/storage`, new actions) still uses `console.*`, and the rate-limit sweep hunk will conflict trivially.

## Done
- Drizzle schema (`lib/db/schema.ts`): 13 domain tables + `rate_limit_buckets`, relations, FKs with delete rules, unique indexes. RLS enabled on all. Versioned in `drizzle/` (0000–0004).
- Supabase client helpers (`lib/supabase/client.ts`, `lib/supabase/server.ts`). No service-role key anywhere, by design.
- Auth: email+password sign-in, phone OTP sign-in (existing accounts only), email sign-up (student role, profile row via DB trigger), password reset via email link → PKCE callback → `/update-password`, sign-out. All actions zod-validated and rate-limited; generic error copy.
- Auth pages (`app/(auth)/*`): login (email/phone tabs), register, reset-password, update-password, on React 19 `useActionState` with shared `components/ui` primitives.
- Authorization chain: `proxy.ts` (JWT role → prefix redirect) → route-group layouts (`requireUser`/`requireRole`) → per-page checks + `lib/data/*` queries that encode enrollment/ownership. See `CLAUDE.md` "Authorization chain".
- First screens: `/` role router; student `/dashboard` + `/courses/[id]`; professor `/professor` + `/professor/courses/[id]` (admin sees all); `/admin` placeholder.
- Security headers + report-only CSP in `next.config.ts`.
- Tooling: vitest (`pnpm test`, 30 tests), `pnpm db:generate|migrate|check`, `API.md` inventory.

## In progress
- Nothing mid-flight. Foundation phase code is complete and committed; **DB migrations are generated but not applied** because the Supabase project is unreachable (see "Blocked on Sam" above). First thing next session: apply migrations and run the live verification list at the bottom of this file.

## Next up
(Priority order per `ORCHESTRATION.md`. Each new feature area gets a plan-mode pass first.)
1. **Apply + verify the foundation** once Supabase is back: `pnpm db:migrate` (baseline first if the old schema exists), then the live verification list below. Add `NEXT_PUBLIC_SITE_URL`, `DIRECT_URL`, fix `DATABASE_URL` encoding, and add the callback URL in the Supabase dashboard.
2. **Core CRUD — courses & lectures** (`backend-builder` + `frontend-builder`): professor creates/edits courses, enrolls students by email (professor enters a student's email on their course page; creates an `enrollments` row tied to that email — works whether the student has an account yet or not, activates on their next signup/login; professor owns their own roster, no join codes or open self-enrollment), uploads lectures to a **private** Supabase Storage bucket (bucket policy: no public reads; server issues short-lived signed URLs), orders lectures. Student course page shows sections only when content exists. Includes the anti-scrub video player, `POST /api/lectures/[id]/progress` (server-validated ≥ threshold), and `GET /api/lectures/[id]/stream` (signed URL, enrollment-checked). Add each to `API.md`.
3. **Exams** (builder UI, publish gate, submissions, manual grading; `reference_answer` never sent to students).
4. **Assignments** (private bucket for uploads, grading).
5. **Forum** (course-level posts, lecture-anchored posts, replies). Consider Realtime → would need the first real RLS policy.
6. **Hardening pass**: enforce CSP with nonces; Playwright e2e for auth + role gating; CI runs `lint`, `test`, `build`, `db:check`; `db:migrate` step in deploy.
7. **Design pass** once `DESIGN.md` exists (vet `npx getdesign` first) — UI is deliberately plain until then.
8. **Profile: attach/verify a phone** on an existing account (needed now that OTP can't create accounts): `updateUser({ phone })` + `verifyOtp({ type: "phone_change" })`.
9. **Admin scope** — needs Sam's definition; today roles are changed by SQL.

## Decisions & assumptions
- This deployment is for a Bible academy, but the codebase, naming, and schema stay generic/institution-agnostic so it can be reused as a template later — see "Current deployment context" in `CLAUDE.md`. Confirmed by Sam 2026-09-16.
- **Enrollment flow (2026-09-18):** professor invites students to a course by email — no join codes, no open self-enrollment. Professor owns their own roster; fits a small known cohort and the minors consideration.
- **Self-registration (2026-09-18):** stays open (any email or phone can create an account) — enrollment, not account creation, is the real access gate. Professors are still promoted to their role by SQL until admin tooling exists. Revisit before real launch if this ever needs tightening.
- **Supabase project (resolved 2026-09-18):** was paused, not deleted; restored, confirmed no real data ever existed in it. See the Foundation phase log above.
- **Role-change lag (2026-09-18):** accepted as-is. The proxy's coarse role redirect can lag up to an hour after a role change (JWT refresh); real access control (`requireRole`/`assertRole`, checked server-side on every page/action/handler) is never affected. Not worth building Supabase's Custom Access Token Hook for a cosmetic redirect delay at academy scale.
- **CAPTCHA (2026-09-18):** deferred. Existing per-IP/per-identifier rate limiting on every auth endpoint covers the main abuse vector for now; revisit Cloudflare Turnstile only if real abuse traffic shows up.
- **`npx getdesign` vetted (2026-09-18):** safe to run. Real GitHub repo (`VoltAgent/awesome-design-md`), 5 months old, ~12.5k downloads/month, zero dependencies. Read the actual 323-line source: only file ops are copying a bundled local template into the project; only network call is a single disableable (`GETDESIGN_DISABLE_TELEMETRY=1`) download-count ping that can't fail the install. No exec/spawn/eval anywhere.
- **Admin scope (2026-09-18):** reframed, not just deferred. Since this codebase will eventually be sold or donated as an independent, self-hosted template — not a SaaS Sam operates for other institutions — admin needs to become real in-app tooling (manage professor/student roles and accounts without database access) before any redistribution happens. For Sam's own church instance, SQL-based role promotion staying manual during build-out is fine and not being reprioritized ahead of Core CRUD. Each future deployment is independent/single-tenant (own domain, own Supabase project, no shared multi-tenancy) — no tenant-isolation work needed, just eventual self-service admin tooling and, later, setup documentation for a fresh deployment.
- **Backups (2026-09-18):** restore mechanism tested and confirmed working — `npx supabase db dump --db-url "$DIRECT_URL" -f backup.sql`, restored into a throwaway local Postgres container, all 15 tables came back with correct columns/types/defaults/FKs/indexes and RLS enabled. This validates a manual backup/restore procedure independent of Supabase's own opaque automated daily backups (free tier, no PITR, still untested on Supabase's side). Worth a recurring automated version of this dump eventually (`resilience-builder`'s domain) — not urgent with an empty DB.
- The 13 `audit-prompts/*.md` files are pass/fail audit checklists, **not build instructions** (confirmed by Sam 2026-09-16). Build agents pull actual work items from this file's "Next up" and from `CLAUDE.md`, build them, then score their own work against the relevant checklist(s) before committing.
- Audit checklists must be **re-read from the file and re-run regularly**, not read once and relied on from memory — each build agent's definition says to re-read its file(s) fresh before every self-check, and to re-run the full checklist after every chunk of work in its domain, not just the first time it touches that domain.
- Build agents (`.claude/agents/*.md`) are active as of 2026-09-16 — all 13 audit-prompt files now have real content.
- **Branch workflow (2026-09-18):** no one commits directly to `main` anymore — not the build agents, not Sam's own interactive sessions. Solo/sequential work checks out its own branch first (`git checkout -b <type>/<slug>`); parallel work via `-w`/worktrees branches automatically either way. Stop for Sam's review/merge, don't self-merge to `main`. This is go-forward only — the 16 commits already on `main` (2026-09-16 through 2026-09-18, orchestration setup through the foundation phase and the migrations-applied milestone) predate the rule and aren't being rewritten.

## Open questions for Sam
- **Role-change lag**: the proxy's coarse redirect reads the role from the JWT, which refreshes hourly; DB-backed checks are immediate. Acceptable, or configure Supabase's Custom Access Token Hook for instant propagation?
- **CAPTCHA** (Cloudflare Turnstile, free) on register/OTP later — new third-party service, so flagging rather than adding.
- Supabase dashboard settings to confirm: email confirmations on; "notify user on password change" on; Auth rate limits at defaults; min password length 8; Redirect URLs include `<site>/api/auth/callback`.
- The `npx getdesign@latest add claude` design step runs a third-party npm package — vet before running.
- Admin role scope is still TBD.
- Backups: Supabase free tier has daily backups but no PITR; restore has not been tested. Decide whether that's acceptable before real student data lands.

## Audit self-check (2026-09-17, after commit 11; checklists re-read from disk)

Scored honestly — items that can't be verified until the DB is reachable are marked **unverified**, not pass.

**auth-and-permissions.md** — 4/6 pass, 2 unverified
- Authentication flow: **pass** — Supabase Auth (bcrypt, email confirmation on, PKCE links).
- Authorization enforcement: **pass** — three-gate chain; every page/action/handler checks itself; data queries encode ownership.
- Row-level security: **pass** (verified 2026-09-18) — deny-all RLS + revoked grants applied and confirmed live (RLS true on all 14 tables, 0 anon/authenticated grants, PostgREST returns 401/42501). App-layer ownership checks are in every query as the actual access path.
- Session management: **pass** — Supabase sessions (1h JWT, refresh via proxy `getClaims`), `signOut` invalidates. Absolute session lifetime is a dashboard setting to confirm.
- Password reset: **unverified** — links are single-use PKCE codes with Supabase's expiry; "notify owner on password change" is a dashboard toggle Sam must enable.
- Protected routes: **pass** — proxy denies by default; only `/login`, `/register`, `/reset-password`, `/api/auth/*` are public. Build output lists every route; all are in `API.md`.

**security-and-rls.md** — 5/7 pass, 1 unverified, 1 n/a
- RLS on every table: **pass** (verified 2026-09-18, live). Policies are intentionally none (deny-all).
- Secrets: **pass** — env only; no service-role key exists; `.env.local` git-ignored.
- HTTPS: **pass** — Vercel TLS; HSTS + `upgrade-insecure-requests` in prod CSP.
- Input sanitization: **pass** — zod on every action; Drizzle parameterises SQL; React escapes output.
- CORS: **n/a** — no cross-origin API consumers; route handlers are same-origin only. Revisit if a mobile client appears.
- Auth on every endpoint: **pass** — see `API.md`.
- Security headers: **pass** — CSP is report-only for now (documented why).

**apis-and-backend.md** — 5/6 pass, 1 partial
- Organization: **pass** — one handler so far, conventions documented.
- Error handling: **pass** — `ActionState` for actions, `handleRouteError` for handlers; no Supabase messages leak.
- Input validation: **pass** — zod everywhere.
- Authentication: **pass**.
- Response quality: **pass** — explicit column selects; `reference_answer` etc. never selected.
- Performance: **partial** — course lists are unpaginated (fine at academy scale; revisit with real numbers).

**database-and-storage.md** — 4/6 pass, 2 open
- Schema design / Relationships / Unique constraints / Indexes: **pass** (FKs with cascade/restrict/set-null, unique email/phone/enrollment/progress/submission, order indexes).
- File storage: **open** — Storage buckets not created yet (next phase; must be private).
- Backups: **open** — see questions.

**rate-limiting.md** — 3/7 pass, 4 open (most items are ops/cost, `resilience-builder`'s domain)
- Limits on expensive endpoints: **pass** — OTP send 3/h per phone, 10/h per IP (Twilio spend); all auth endpoints limited.
- Billing alerts: **open** — Twilio/Supabase spend alerts are dashboard config for Sam.
- Debouncing: **n/a** — no search/autocomplete yet.
- 429 handling: **pass** — limiter returns a wait time and human copy; no retry loops needed for form submits.
- API key management: **pass** — env-scoped; separate Supabase projects per env is the Vercel-env convention to follow.
- Usage monitoring / cost per feature: **open** — no logging/metrics stack yet (resilience phase).

## Live verification checklist (run once the DB is reachable)
1. `pnpm db:migrate` twice (second is a no-op); `pnpm db:check`; `pnpm db:generate` says no changes.
2. SQL: `select tablename, rowsecurity from pg_tables where schemaname='public'` → all true; `select grantee, table_name from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')` → 0 rows; `select tgname from pg_trigger where not tgisinternal` → `on_auth_user_created`, `on_auth_user_contact_updated`, `on_public_user_role_changed`.
3. PostgREST with the anon key: `GET /rest/v1/users?select=id&limit=1` → 401/403 with `42501`, not `200 []`; `POST /rest/v1/forum_posts` denied; `GET /rest/v1/` lists no tables.
4. Register → confirmation email → `/api/auth/callback` → `/dashboard`; `public.users` row exists with `role='student'` and `auth.users.raw_app_meta_data.role='student'`.
5. Six wrong passwords → rate-limit message; reset link → `/update-password` → new password signs in; OTP for an unknown phone → error and no new auth user.
6. Student visits `/professor` and `/admin` → sent to `/dashboard`. Promote via SQL, sign out/in → `/` lands on `/professor`; `/courses/<unenrolled id>` → 404.
7. `curl -I <site>/login` → security headers present, no `x-powered-by`.
