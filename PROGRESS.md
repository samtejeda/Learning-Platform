# Progress

Source of truth for where this project actually stands. Read this before resuming work in a new session — trust this over assumptions in `CLAUDE.md`'s narrative sections, since code moves faster than docs.

Last reconciled: 2026-09-18 (foundation phase complete; CI + Vercel config added on `chore/ci-and-vercel`, PR #1).

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

**Still open from the live verification checklist:** steps 4–5 (register → confirm-by-email → dashboard; rate-limit/reset/OTP behavior) need real inboxes/SMS — by hand. Steps 6–7 verified 2026-09-21 against `next start`: student → `/professor` and `/admin` bounce to `/dashboard`; `/courses/<unenrolled id>` → 404; security headers present, no `x-powered-by` (`test/http/lectures.http.test.ts`, `curl -I`). Promote-by-SQL → `/` landing on `/professor` is covered by the seeded professor sessions in the same test.

## Core CRUD phase — courses & lectures (2026-09-18, branch `worktree-academy-backend`) — commit log
Plan approved by Sam 2026-09-18 with the four decisions below (see "Decisions & assumptions"). Backend-builder pass: server side + minimal plain UI so the branch is testable end-to-end; the frontend worktree restyles later (see "Frontend handoff").
- [x] 1. Schema + migrations `0005` (`course_invitations`; lecture `description`/`duration_seconds`/`video_uploaded_at`/`published_at`; progress `watched_intervals`/`last_position_seconds`/`completed_at`) and `0006` (invitation → enrollment trigger `on_public_user_email_set`; private `lectures` bucket, 2 GiB cap, mp4/webm/mov). `lib/storage/` (service-role client, **Storage only**), `SUPABASE_SERVICE_ROLE_KEY` in `.env.local.example` + `API.md`. Applied + verified live (migrate no-op on rerun, `db:check` clean, bucket private, trigger present, RLS on the new table). **Sam: add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` (main checkout + this worktree) before upload/stream testing.**
- [x] 5. Streaming + server-validated progress: `lib/progress/policy.ts` (pure, 12 unit tests — merge intervals, ≤20 s segments, coverage can't grow faster than wall-clock ×1.5 + 2 s, sticky completion at the lecture's threshold), `lib/data/progress.ts` (`getLectureForViewer`: enrolled+published or owner preview; `recordProgress`: transaction with `FOR UPDATE`, enrollment re-checked inside), `GET /api/lectures/[id]/stream` (15-min signed URL, `no-store`), `POST /api/lectures/[id]/progress` (same-origin guard `isSameOrigin` in `lib/api/respond.ts`, rate-limited, strict zod body; fabricated bursts return `accepted:false` and are never credited), student lecture page + `components/video-player/lecture-player.tsx` (no native controls, seeks only into server-accepted ranges, 10 s pings, refetches an expired URL). 5 integration tests drive the real handlers (401/403/404/400/429, burst ignored, real playback completes). **Bug fixed in the foundation limiter:** the fire-and-forget bucket sweep in `lib/rate-limit/index.ts` never executed under the vitest harness and pinned the single-connection dev pool (worked in plain Node); it is now awaited, with `lib/rate-limit/sweep.integration.test.ts` as the regression guard.
- [x] 4. Lectures: `lib/validation/lectures.ts` (+tests), `getOwnedLecture` (ownership joined through the course) + writes in `lib/data/lectures.ts` (insert with next order, mark uploaded, publish gated on upload, reorder in one transaction covering exactly the course's lectures, delete), `lib/lectures/actions.ts` (`createLecture` → signed upload token for a server-chosen path, `retryLectureUpload`, `finalizeLectureUpload` verifies the object + content type server-side, `publishLecture`/`unpublishLecture`, `updateLecture`, `reorderLectures`, `deleteLecture` removes the object first). UI: `components/lecture-upload-form.tsx` (browser → Storage directly via `uploadToSignedUrl`, reads duration locally, then finalizes), `components/lecture-list-manager.tsx` (status, publish/unpublish, delete, move up/down, retry pending upload, edit link), `/professor/lectures/[id]/edit`. 7 integration tests (Storage mocked; the real signed-URL round trip still needs the service-role key — see Blocked).
- [x] 3. Enrollment invites: `inviteByEmail` (one transaction; enrolls now if the account exists, else stores the invitation for the 0006 trigger), `removeEnrollment`, `removeInvitation`; `lib/enrollments/actions.ts` (`inviteStudent` rate-limited 40/h per professor, `removeStudent`, `revokeInvitation`); `components/roster-manager.tsx` on the professor course page. **Integration-test harness** added: `pnpm test:integration` runs `lib/**/*.integration.test.ts` against the DB in `.env.local` with Next request plumbing stubbed and dev-only `@example.test` accounts seeded (`test/seed.ts`; refuses to run without `INTEGRATION_TESTS=1`). 17 tests prove the ownership rules, invite idempotency, trigger-on-signup activation, and the rate limit against the real DB.
- [x] 2. Courses: `lib/validation/courses.ts` (+tests), `findOwnedCourse` / `insertCourse` / `updateCourse` in `lib/data/courses.ts` (ownership in every WHERE, admin bypass), `lib/data/lectures.ts` (professor list with status; student list = published only + own progress), `lib/data/enrollments.ts` (`listRoster`), `lib/courses/actions.ts` (`createCourse`, `updateCourse`), `components/course-form.tsx`, `/professor/courses/new`, `/professor/courses/[id]/edit`, professor course page shows lecture status + roster, student course page links lectures and shows percent/completed.

## Platform ops: CI + Vercel config (2026-09-18) — branch `chore/ci-and-vercel`, PR #1 (awaiting Sam's merge)
- [x] 1. Toolchain pinned: `packageManager: pnpm@11.0.8`, `engines.node: 24.x`, `.nvmrc`, `pnpm typecheck`.
- [x] 2. `.github/workflows/ci.yml`: one `checks` job on every PR and push to `main` — lint, typecheck, unit tests, `db:check`, `build`. Placeholder env only (build evaluates `lib/db/index.ts`, which throws without `DATABASE_URL`, but nothing connects at build time), no secrets. Shallow clone. **Verified green on GitHub** (run on PR #1). Integration tests deliberately excluded (need a real DB). `.github/dependabot.yml`: weekly, grouped npm + Actions updates.
- [x] 3. `vercel.json` + `scripts/vercel-build.sh` (`pnpm build:vercel`): production builds run `drizzle-kit migrate` then `next build`; previews skip migrations; fails fast without `DIRECT_URL`. Region `iad1` (Supabase pooler is us-east-1). Verified locally: preview path skips + builds; production path without `DIRECT_URL` exits 1. The production path with a real `DIRECT_URL` was not run locally on purpose.
- [x] 4. GitHub settings applied: `main` protected (required check `checks`, up-to-date branch required, PR required, 0 approvals, admins may bypass, no force-push/deletion); delete-branch-on-merge on.

### Sam: Vercel setup checklist (I can't do this part: it needs your login)
1. vercel.com → Add New → Project → import `samtejeda/Learning-Platform`. Framework (Next.js) and build/install commands come from `vercel.json`. Production branch: `main`.
2. Environment variables. **Production:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` (real `https://` origin; use the `*.vercel.app` URL until a domain exists, then redeploy), `DATABASE_URL` (transaction pooler, 6543, percent-encoded), `DIRECT_URL` (session pooler, 5432, **Production scope only**). **Preview:** the same four *except* `DIRECT_URL`. See the scope notes in `.env.local.example`.
3. Supabase → Auth → URL Configuration: set Site URL and add `<origin>/api/auth/callback` to Redirect URLs (and a wildcard for preview URLs if you want auth to work on previews).
4. First deploy, then check: `curl -I https://<origin>/login` shows the security headers and no `x-powered-by`; open a throwaway PR and confirm a preview URL appears; run **Instant Rollback** once (Deployments → an earlier deploy → Instant Rollback, then promote the latest again) so "rollback tested" is real.
5. Billing: Vercel → Settings → Billing/Spend alerts, and Supabase → usage alerts.

## Done
- Drizzle schema (`lib/db/schema.ts`): 14 domain tables + `rate_limit_buckets`, relations, FKs with delete rules, unique indexes. RLS enabled on all. Versioned in `drizzle/` (0000–0006).
- Supabase client helpers (`lib/supabase/client.ts`, `lib/supabase/server.ts`). Service-role key exists **only** for `lib/storage/` (signed URLs on the private `lectures` bucket); never used for DB access.
- Auth: email+password sign-in, phone OTP sign-in (existing accounts only), email sign-up (student role, profile row via DB trigger), password reset via email link → PKCE callback → `/update-password`, sign-out. All actions zod-validated and rate-limited; generic error copy.
- Auth pages (`app/(auth)/*`): login (email/phone tabs), register, reset-password, update-password, on React 19 `useActionState` with shared `components/ui` primitives.
- Authorization chain: `proxy.ts` (JWT role → prefix redirect) → route-group layouts (`requireUser`/`requireRole`) → per-page checks + `lib/data/*` queries that encode enrollment/ownership. See `CLAUDE.md` "Authorization chain".
- First screens: `/` role router; student `/dashboard` + `/courses/[id]`; professor `/professor` + `/professor/courses/[id]` (admin sees all); `/admin` placeholder.
- **Courses & lectures (branch `worktree-academy-backend`, 2026-09-18):** professor creates/edits courses; invites students by email (immediate enrollment if the account exists, otherwise auto-enrolled on signup by DB trigger); uploads lecture videos straight from the browser to a private bucket via server-issued signed URLs, finalizes (server verifies the object), publishes, reorders, deletes; students see only published lectures, stream via 15-min signed URLs, and completion is decided server-side from merged watched ranges bounded by wall-clock time. Minimal plain UI included; see "Frontend handoff".
- Security headers + report-only CSP in `next.config.ts`.
- Tooling: vitest (`pnpm test`, 57 unit tests; `pnpm test:integration`, 36 tests against the dev DB + real Storage; `pnpm test:http`, 7 tests against a running server), `pnpm db:generate|migrate|check`, `API.md` inventory.

- [x] 6. Docs reconcile: `API.md` complete for every route in `pnpm build` output; `CLAUDE.md` structure + data-access notes updated; frontend handoff + audit self-check below. **Branch `worktree-academy-backend` is ready for Sam's review/merge.**

- [x] 7. Real-Storage + real-HTTP verification (2026-09-21, after Sam added `SUPABASE_SERVICE_ROLE_KEY`): `lib/storage/storage.integration.test.ts` (unmocked round trip: server-issued token → anon browser client uploads → `info` → signed URL serves bytes and honours `Range` → delete; a token for path A can't write path B; the bucket itself rejects `text/html`; anon can't download/list/sign/read publicly). `pnpm test:http` (`test/http/`, `vitest.http.config.mts`) drives a **running** server with real Supabase sessions, the real proxy, a real 25 s ffmpeg-made MP4 uploaded exactly the way the upload form does, and real wall-clock time: 401/404/403/400 matrix on both handlers, burst pings ignored, real-pace playback completes (`justCompleted`), students never see drafts (page HTML checked), role-prefix bounces, cross-professor 404 on every professor page. **Found and fixed:** signed-out `/api/*` calls got a `307` to the login page (a `fetch` client follows it and receives HTML with `200`); `proxy.ts` now returns the documented JSON `401` for signed-out API paths (`isApiPath` in `lib/auth/roles.ts`, tested).

## In progress
- Nothing mid-flight. `worktree-academy-backend` (7 commits) awaits Sam's review/merge. Verified: `pnpm test` (57 unit) + `pnpm test:integration` (36, real DB + real Storage) + `pnpm test:http` (7, live server; run twice, stable) + `pnpm lint` + `pnpm build`. Still by hand (needs a real browser): see "Manual checks that remain".

## Frontend handoff (for the `academy-frontend` worktree)
Read this branch before restyling: `git show worktree-academy-backend:API.md` (contracts) and `git diff main..worktree-academy-backend --stat`. Every UI piece below is deliberately plain and free to restyle/replace; the **load-bearing** parts are the field names (they match the zod schemas) and the player's server-driven behaviour.
- `components/course-form.tsx` — fields `title`, `description`; used for course create/edit and lecture edit. Takes a bound server action.
- `components/roster-manager.tsx` — invite form (`email`) + rows with `studentId` / `invitationId` hidden fields → `inviteStudent` / `removeStudent` / `revokeInvitation`.
- `components/lecture-upload-form.tsx` — the 3-step upload (`createLecture` → `supabase.storage.from(bucket).uploadToSignedUrl(path, token, file)` → `finalizeLectureUpload({ durationSeconds })`). Keep the order; the server verifies the object before the lecture can be published. Has an upload-progress placeholder (Supabase's `uploadToSignedUrl` doesn't expose progress; use XHR against the signed URL if a real bar is wanted).
- `components/lecture-list-manager.tsx` — status badge (`pending_upload` / `draft` / `published`), publish/unpublish/delete, move up/down (`reorderLectures(courseId, { orderedIds })` needs the full list), retry pending upload.
- `components/video-player/lecture-player.tsx` — **keep:** no native controls; `GET /api/lectures/[id]/stream` for the URL (refetch on expiry/error); seeks only into `intervals` returned by the server; `POST /api/lectures/[id]/progress` with `{ from, to, position }` every ~10 s of playback and on pause/seek/end/tab-hide; segments ≤ 20 s; percent/completed displayed only from server responses. Everything visual is yours.
- Pages: `/professor/courses/new`, `/professor/courses/[id]` (edit link, lectures, add-lecture, roster), `/professor/courses/[id]/edit`, `/professor/lectures/[id]/edit`, `/courses/[id]` (lecture links + percent), `/courses/[id]/lectures/[lectureId]`.
- Data shapes to render: `ProfessorCourseDetail` / `StudentCourseDetail` in `lib/data/courses.ts`, `ProfessorLecture` / `StudentLecture` in `lib/data/lectures.ts`, `LectureView` / `ProgressView` in `lib/data/progress.ts`, `Roster` in `lib/data/enrollments.ts`.

## Manual checks that remain (need a real browser — nothing else is left)
Everything server-side is automated (`pnpm test:http` covers the wire: sessions, proxy, Storage, handlers, pages). These are the browser-only behaviours no test here can see:
1. **Upload form click-through:** `/professor/courses/<id>` → Add a lecture → pick a short MP4 (< 50 MB on the free tier) → it goes Upload pending → Draft with the right duration → Publish.
2. **Player in a real browser:** as the student, play the lecture; percent climbs in ~10 s steps; click ahead on the bar (should snap back to where you were); seek *back* into watched material (allowed); reach Completed at 95 %; reload mid-lecture and confirm it resumes.
3. **Expired session mid-video:** the player's calls now get a JSON `401`; confirm it shows "This video isn't available" rather than hanging.
4. **Invite → register flow with a real inbox:** invite a brand-new email, register it, confirm via the emailed link, and check the roster flips Invited → Enrolled by itself (the trigger is proven in `test:integration`; the email round trip is not).
5. `pnpm dev` from a **fresh clone** of this branch: `pnpm install`, `.env.local` from `.env.local.example` incl. `SUPABASE_SERVICE_ROLE_KEY`, `pnpm db:migrate`.

To re-run the automated wire tests: `pnpm build && pnpm start -p 3111` in one terminal, `pnpm test:http` in another (~55 s; it waits real seconds to prove the wall-clock rule). Seeds and removes its own `@example.test` accounts, course, lectures, and Storage objects.

## Next up
(Priority order per `ORCHESTRATION.md`. Each new feature area gets a plan-mode pass first.)
1. ~~Apply + verify the foundation~~ — done 2026-09-18 (steps 4–7 of the live checklist still manual).
2. **Core CRUD — courses & lectures** — in progress (above). Deferred from this pass: end-of-lecture comprehension question authoring; course deletion UI (cascade + storage cleanup); CSP tightening for signed URLs.
3. **Exams** (builder UI, publish gate, submissions, manual grading; `reference_answer` never sent to students).
4. **Assignments** (private bucket for uploads, grading).
5. **Forum** (course-level posts, lecture-anchored posts, replies). Consider Realtime → would need the first real RLS policy.
6. **Hardening pass**: enforce CSP with nonces; Playwright e2e for auth + role gating. (CI running `lint`/`test`/`build`/`db:check` and the production `db:migrate` deploy step are done: see "Platform ops" above; only the Vercel dashboard setup is left.)
7. **Design pass** once `DESIGN.md` exists (vet `npx getdesign` first) — UI is deliberately plain until then.
8. **Profile: attach/verify a phone** on an existing account (needed now that OTP can't create accounts): `updateUser({ phone })` + `verifyOtp({ type: "phone_change" })`.
9. **Admin scope** — needs Sam's definition; today roles are changed by SQL.

## Decisions & assumptions
- This deployment is for a Bible academy, but the codebase, naming, and schema stay generic/institution-agnostic so it can be reused as a template later — see "Current deployment context" in `CLAUDE.md`. Confirmed by Sam 2026-09-16.
- **Enrollment flow (2026-09-18):** professor invites students to a course by email — no join codes, no open self-enrollment. Professor owns their own roster; fits a small known cohort and the minors consideration.
- **Core CRUD decisions (Sam, 2026-09-18):** (1) `SUPABASE_SERVICE_ROLE_KEY` is allowed server-side **for Storage only** (`lib/storage/`), never for DB queries — reverses the earlier "no service-role key anywhere" note; the bucket has no storage policies, so the browser can only act on server-signed URLs. (2) Backend pass ships minimal plain UI so the branch is testable; frontend worktree restyles. (3) Roster shows "Enrolled" vs "Invited" (reveals to a professor whether an email has an account — accepted; professors are trusted staff, action is rate-limited). (4) Lecture video stays on Supabase Storage; free tier caps objects at 50 MB, so test with short clips and upgrade to Pro before real lectures — no third-party video host.
- **Self-registration (2026-09-18):** stays open (any email or phone can create an account) — enrollment, not account creation, is the real access gate. Professors are still promoted to their role by SQL until admin tooling exists. Revisit before real launch if this ever needs tightening.
- **Supabase project (resolved 2026-09-18):** was paused, not deleted; restored, confirmed no real data ever existed in it. See the Foundation phase log above.
- **Role-change lag (2026-09-18):** accepted as-is. The proxy's coarse role redirect can lag up to an hour after a role change (JWT refresh); real access control (`requireRole`/`assertRole`, checked server-side on every page/action/handler) is never affected. Not worth building Supabase's Custom Access Token Hook for a cosmetic redirect delay at academy scale.
- **CAPTCHA (2026-09-18):** deferred. Existing per-IP/per-identifier rate limiting on every auth endpoint covers the main abuse vector for now; revisit Cloudflare Turnstile only if real abuse traffic shows up.
- **`npx getdesign` vetted (2026-09-18):** safe to run. Real GitHub repo (`VoltAgent/awesome-design-md`), 5 months old, ~12.5k downloads/month, zero dependencies. Read the actual 323-line source: only file ops are copying a bundled local template into the project; only network call is a single disableable (`GETDESIGN_DISABLE_TELEMETRY=1`) download-count ping that can't fail the install. No exec/spawn/eval anywhere.
- **Admin scope (2026-09-18):** reframed, not just deferred. Since this codebase will eventually be sold or donated as an independent, self-hosted template — not a SaaS Sam operates for other institutions — admin needs to become real in-app tooling (manage professor/student roles and accounts without database access) before any redistribution happens. For Sam's own church instance, SQL-based role promotion staying manual during build-out is fine and not being reprioritized ahead of Core CRUD. Each future deployment is independent/single-tenant (own domain, own Supabase project, no shared multi-tenancy) — no tenant-isolation work needed, just eventual self-service admin tooling and, later, setup documentation for a fresh deployment.
- **Backups (2026-09-18):** restore mechanism tested and confirmed working — `npx supabase db dump --db-url "$DIRECT_URL" -f backup.sql`, restored into a throwaway local Postgres container, all 15 tables came back with correct columns/types/defaults/FKs/indexes and RLS enabled. This validates a manual backup/restore procedure independent of Supabase's own opaque automated daily backups (free tier, no PITR, still untested on Supabase's side). Worth a recurring automated version of this dump eventually (`resilience-builder`'s domain) — not urgent with an empty DB.
- **CI and deploy (2026-09-18, Sam):** Vercel is not set up yet. Migrations run in the Vercel build command for **Production only** (a failed migration fails the deploy, so the old version stays live; previews can never migrate). Branch protection on `main` requires the `checks` job and a PR. Migrations are forward-only: a Vercel rollback reverts code, not schema, so migrations must stay backward-compatible with the previous deploy.
- The 13 `audit-prompts/*.md` files are pass/fail audit checklists, **not build instructions** (confirmed by Sam 2026-09-16). Build agents pull actual work items from this file's "Next up" and from `CLAUDE.md`, build them, then score their own work against the relevant checklist(s) before committing.
- Audit checklists must be **re-read from the file and re-run regularly**, not read once and relied on from memory — each build agent's definition says to re-read its file(s) fresh before every self-check, and to re-run the full checklist after every chunk of work in its domain, not just the first time it touches that domain.
- Build agents (`.claude/agents/*.md`) are active as of 2026-09-16 — all 13 audit-prompt files now have real content.
- **Branch workflow (2026-09-18):** no one commits directly to `main` anymore — not the build agents, not Sam's own interactive sessions. Solo/sequential work checks out its own branch first (`git checkout -b <type>/<slug>`); parallel work via `-w`/worktrees branches automatically either way. Stop for Sam's review/merge, don't self-merge to `main`. This is go-forward only — the 16 commits already on `main` (2026-09-16 through 2026-09-18, orchestration setup through the foundation phase and the migrations-applied milestone) predate the rule and aren't being rewritten.

## Open questions for Sam
- **Vercel plan**: I believe the free Hobby plan is limited to non-commercial use. Confirm whether a church academy qualifies, or plan for Pro (a paid service, so your call). Also check plan limits on function duration before the lecture stream/upload routes land.
- **Preview database**: there is only one Supabase project today, so a preview deploy pointed at it shares the real DB. Fine while it holds no real data; before launch, create a separate dev project for Preview scope (or leave Preview env unset so previews only build).
- **`node_modules/` in git history**: the initial commit (`2e62aeac`) committed it, so the pack is ~105 MiB. It's not tracked on `main` now, and CI uses a shallow clone. Removing it means rewriting history and force-pushing (every worktree/branch would need re-basing), so I didn't do it. Worth doing before the repo is sold or donated as a template; not urgent.
- **`pool max: 10`** in `lib/db/index.ts` is per serverless instance. Under load, many concurrent Vercel instances × 10 could hit the Supabase pooler's client limit. Consider `max: 1–3` in production (backend's file, so flagging rather than editing).
- **Role-change lag**: the proxy's coarse redirect reads the role from the JWT, which refreshes hourly; DB-backed checks are immediate. Acceptable, or configure Supabase's Custom Access Token Hook for instant propagation?
- **CAPTCHA** (Cloudflare Turnstile, free) on register/OTP later — new third-party service, so flagging rather than adding.
- Supabase dashboard settings to confirm: email confirmations on; "notify user on password change" on; Auth rate limits at defaults; min password length 8; Redirect URLs include `<site>/api/auth/callback`.
- The `npx getdesign@latest add claude` design step runs a third-party npm package — vet before running.
- Admin role scope is still TBD.
- Backups: Supabase free tier has daily backups but no PITR; restore has not been tested. Decide whether that's acceptable before real student data lands.

## Audit self-check (2026-09-18, core CRUD branch, after commit 6; `audit-prompts/apis-and-backend.md` re-read from disk after every chunk)

**apis-and-backend.md** — 5/6 pass, 1 partial. Specific examples are the integration tests in `lib/data/*.integration.test.ts`.
- Endpoint organization: **pass** — actions grouped per domain (`lib/courses`, `lib/enrollments`, `lib/lectures`), handlers under `/api/lectures/[id]/{stream,progress}` with GET for reads and POST for the mutation; all in `API.md`.
- Error handling: **pass** — actions return `ActionState`/`UploadTicket` on every expected failure (storage down → "Upload is unavailable right now", row kept for retry); handlers map to 400/401/403/404/409/429/503 via `handleRouteError`; malformed JSON → 400 (tested).
- Input validation: **pass** — zod before every DB call, including bound ids (`updateCourse("not-a-uuid")` → generic error, no query) and strict progress bodies (extra field → 400, `to − from > 20` → 400).
- Authentication: **pass** — `assertRole`/`assertUser` first, then ownership/enrollment inside the query (`findOwnedCourse`, `getOwnedLecture`, `getLectureForViewer`); professor B on A's course → "not found" for update/invite/publish/reorder/delete; unenrolled student → 404 on course, stream, progress; all tested.
- Response quality: **pass** — stream returns only `{ url, expiresAt }`; progress returns the student's own numbers; roster exposes name + email to the owning professor only; `UploadTicket` carries a one-time token for one path.
- Performance: **partial** — course/lecture/roster lists unpaginated (fine at academy scale; revisit with real numbers). A progress ping is ~6 statements in one transaction every ~10 s per active viewer, and measured latency is ≈ 1 s per authenticated request from a laptop to remote Supabase (see Open questions for the two cheap fixes; not yet measured from Vercel). A course-level completion summary should be one aggregate query when it's built, not N lookups.
- Re-scored 2026-09-21 after real-wire testing (checklist re-read from disk): **Error handling** improved — signed-out API calls now return the documented JSON 401 instead of an HTML redirect (found by `test:http`, fixed in `proxy.ts`). Still 5/6.
- Top 3 to fix next: (1) paginate the professor roster/lecture lists once a course exceeds ~200 rows; (2) real upload progress bar via XHR against the signed URL; (3) enforce CSP now that the media origin is known (hardening pass).

**database-and-storage.md** — File storage: now **pass** (videos in Supabase Storage, private bucket, MIME allowlist, size cap; paths server-generated). Schema/relationships/unique/indexes: pass (`course_invitations` unique `(course_id, email)` + email index; lecture order index). Backups: still open.

**security-and-rls.md** — RLS on every table incl. `course_invitations`: pass. No storage policies on the bucket (deny-all; server-signed URLs only): pass. Service-role key: server-only, Storage-only, documented.

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

## Platform-ops audit self-check (2026-09-18, after the CI/Vercel branch; the three checklists re-read from disk)

**cicd-and-version-control.md** — 4/6 pass, 2 open
- Commit hygiene: **pass** — recent commits touch 1–9 files with descriptive messages; this branch is 3 small commits. (The initial commit was a large dump that included `node_modules/`; history isn't being rewritten.)
- Branch strategy: **pass** — PR #1 from `chore/ci-and-vercel`; `main` protected. (Pre-2026-09-18 direct commits predate the rule.)
- Automated checks: **pass** — `checks` job green on GitHub (lint, typecheck, 30 tests, `db:check`, build).
- Deployment pipeline: **open** — config is ready, Vercel project not created yet (Sam's checklist).
- Security: **pass** — scanned all history for Supabase/Twilio/JWT/Postgres-URL patterns: no credentials (only comments mentioning `service_role`). Caveat: pattern scan, not a guarantee; and the `node_modules` commit is a hygiene issue, not a secret one.
- Recovery readiness: **open** — `git revert` via PR works but hasn't been exercised; Vercel Instant Rollback untested until the project exists.

**hosting-and-deployment.md** — 1/6 verified, 5 blocked on the Vercel project
- Environment variables: **partial** — nothing hardcoded (verified), `.env.local.example` documents scopes; the values aren't in Vercel yet.
- SSL/HTTPS: **unverified** — no live site. HSTS and `upgrade-insecure-requests` are configured.
- Build process: **pass** — passes with no `.env.local`; only extra step (migrate) is production-only.
- Domain: **open** — no domain chosen.
- Deployment pipeline: **open** — same as above; previews come with the Vercel GitHub integration.
- Rollback readiness: **open** — untested, see above.

**cloud-and-compute.md** — 2/6 pass, 2 partial, 1 n/a, 1 open
- Cost efficiency: **pass** at current scope — nothing runs more than needed; the proxy's JWT check is a local verification.
- Resource sizing: **pass** — platform defaults are ample for academy scale (unmeasured in production).
- Serverless configuration: **partial** — region pinned to `iad1`; timeouts/memory left at defaults until the stream/upload routes exist.
- Data transfer: **n/a for now** — no video yet; design routes video through Supabase Storage signed URLs, not the compute layer.
- Scaling readiness: **partial** — first to break at 10x is DB connections (`max: 10` per instance, see open questions) and Supabase free-tier limits; the Postgres-backed rate limiter adds a write per auth request.
- Billing visibility: **open** — dashboard alerts for Sam (Vercel, Supabase, Twilio).

**Top 3 to close next:** (1) Sam creates the Vercel project from the checklist, (2) run Instant Rollback once, (3) billing alerts.

## Live verification checklist (run once the DB is reachable)
1. `pnpm db:migrate` twice (second is a no-op); `pnpm db:check`; `pnpm db:generate` says no changes.
2. SQL: `select tablename, rowsecurity from pg_tables where schemaname='public'` → all true; `select grantee, table_name from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')` → 0 rows; `select tgname from pg_trigger where not tgisinternal` → `on_auth_user_created`, `on_auth_user_contact_updated`, `on_public_user_role_changed`.
3. PostgREST with the anon key: `GET /rest/v1/users?select=id&limit=1` → 401/403 with `42501`, not `200 []`; `POST /rest/v1/forum_posts` denied; `GET /rest/v1/` lists no tables.
4. Register → confirmation email → `/api/auth/callback` → `/dashboard`; `public.users` row exists with `role='student'` and `auth.users.raw_app_meta_data.role='student'`.
5. Six wrong passwords → rate-limit message; reset link → `/update-password` → new password signs in; OTP for an unknown phone → error and no new auth user.
6. Student visits `/professor` and `/admin` → sent to `/dashboard`. Promote via SQL, sign out/in → `/` lands on `/professor`; `/courses/<unenrolled id>` → 404.
7. `curl -I <site>/login` → security headers present, no `x-powered-by`.
