# API Inventory

Every server entry point in the app, in one place. **Rule: a new route handler or server action is added here in the same commit that creates it.** Anything under `app/api/**/route.ts` or exported from a `"use server"` file that isn't listed here is an orphan and a bug (CLAUDE.md API Security Rule 9).

## Conventions

**Two kinds of entry point, chosen by who calls them:**

| Kind | Use for | Lives in | Auth check | Failure shape |
|---|---|---|---|---|
| Server action | Forms and mutations invoked only by our own pages | `lib/**/actions.ts` (`"use server"`) | `assertUser()` / `assertRole()` from `lib/auth/session.ts` (throw), or `getCurrentUser()` when "signed out" is an expected state | Returns `ActionState` (`{ error, fieldErrors?, values? }`); never throws on expected failure; `redirect()` only on success and never inside `try/catch` |
| Route handler | Non-form traffic: `fetch` from client components (video progress pings, signed stream URLs), email-link callbacks, anything a non-browser client might call | `app/api/**/route.ts` | `assertUser()` / `assertRole()`; map errors with `handleRouteError()` from `lib/api/respond.ts` | `{ error: { code, message } }` JSON with the right status (400/401/403/404/429/500) |

**Every entry point, both kinds:**
1. Validates input with a zod schema from `lib/validation/*` before anything else (`parseFormData` / `parseObject` for actions, `schema.safeParse(await req.json())` for handlers).
2. Applies rate limiting where the endpoint is unauthenticated or costs money (`enforceAuthRateLimit` / `checkRateLimit` from `lib/rate-limit`).
3. Verifies identity and role server-side, then enforces ownership/enrollment by passing the acting user's id into a `lib/data/*` query that encodes the rule. Never trusts a role or id from the client.
4. Returns only what the caller needs (explicit column selects and DTOs; no `select *`, no passwords/tokens/`reference_answer`).
5. Uses generic user-facing errors that don't reveal whether an account exists.

Proxy (`proxy.ts`) allows `/api/auth/*` and `/api/health` through without a session; every other `/api/*` path requires one before the handler runs, and the handler checks again.

## Route handlers

| Method + path | Auth | Rate limit | Input | Output | Notes |
|---|---|---|---|---|---|
| `GET /api/auth/callback` | Public | Supabase's own (code is single-use) | `?code`, `?next` (sanitised by `safeNextPath`) | 302 to `next`, or `/login?error=link` | Exchanges PKCE code for a session cookie. Used by sign-up confirmation and password-reset emails. Never echoes the code. |
| `GET /api/health` | Public (uptime monitors have no session) | None needed: probe results are cached ~10s per instance, so dependency load is bounded regardless of callers | none | `200 {status:"ok"}` or `503 {status:"degraded", checks:{database, auth}}` (values `ok`/`fail`) | Checks Postgres (`select 1`) and Supabase Auth's health endpoint, 3s timeout each. URL comes from env, never request input. No versions, timings, hosts or error text. `Cache-Control: no-store`. Twilio has no direct probe (only reachable via Supabase Auth). |

## Server actions (`lib/auth/actions.ts`)

All take `(prev: ActionState, formData)` unless noted. "Identifier" is the second rate-limit dimension (see `lib/rate-limit/policy.ts` for thresholds).

| Action | Auth | Rate limit scope / identifier | Schema | On success | Notes |
|---|---|---|---|---|---|
| `signInWithEmail` | Public | `login` / email | `signInSchema` | `redirect(next \| "/")` | Generic "Invalid email or password." on any auth error. `next` sanitised. |
| `sendPhoneOTP({ phone })` | Public | `otp_send` / phone | `sendOtpSchema` | `{ success, values.phone }` (E.164) | `shouldCreateUser: false`: OTP is sign-in only, cannot create accounts. Same message for unknown numbers. Each send costs an SMS. |
| `verifyPhoneOTP({ phone, token, next })` | Public | `otp_verify` / phone | `verifyOtpSchema` | `redirect(next \| "/")` | Generic "Invalid or expired code." |
| `signUp` | Public | `signup` / email | `signUpSchema` | `{ success }` | Role is always `student`; the `public.users` row is created by DB trigger. Existing email returns the same success message. `emailRedirectTo` → callback → `/dashboard`. |
| `requestPasswordReset` | Public | `reset_request` / email | `resetRequestSchema` | `{ success }` always | Never reveals whether the email exists. `redirectTo` → callback → `/update-password`. |
| `updatePassword` | Recovery or normal session (`getCurrentUser`) | — (authenticated) | `updatePasswordSchema` | `redirect(homeForRole)` | Rejects same/weak passwords with specific copy. |
| `signOut()` | Any | — | — | `redirect("/login")` | Invalidates the Supabase session. |

## Pages with data access (for completeness; not APIs)

Pages are gated three times: proxy prefix rule → route-group layout (`requireUser`/`requireRole`) → the page itself, plus the query. See CLAUDE.md "Authorization chain".

| Page | Requires | Data function (enforces) |
|---|---|---|
| `/` | — | redirects by role or to `/login` |
| `/dashboard` | any signed-in user | `listEnrolledCourses(userId)` |
| `/courses/[courseId]` | any signed-in user | `getCourseForStudent(courseId, userId)` (enrollment; 404 otherwise) |
| `/professor` | professor, admin | `listTaughtCourses(userId)` / admin: `listAllCourses()` |
| `/professor/courses/[courseId]` | professor, admin | `getCourseForProfessor(courseId, userId, { isAdmin })` (ownership; 404 otherwise) |
| `/admin` | admin | placeholder |

## Environment variables

| Variable | Used by | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase clients, proxy, CSP | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase clients, proxy | yes |
| `NEXT_PUBLIC_SITE_URL` | `lib/env.ts` for email links | yes in production |
| `DATABASE_URL` | Drizzle at runtime (transaction pooler, 6543) | yes |
| `DIRECT_URL` | drizzle-kit only (session pooler, 5432) | for migrations |

No service-role key exists in the app and none should be added; server-side data access uses the table-owner connection, and PostgREST is fully denied (see `drizzle/0002`).

## Migrations

`drizzle/` is the versioned history. Workflow: edit `lib/db/schema.ts` → `pnpm db:generate` → review → commit → `pnpm db:migrate` (run before every deploy; CI step is platform-ops work). Custom SQL (grants, triggers): `pnpm exec dotenv -e .env.local -- drizzle-kit generate --custom --name=<slug>`.

| # | File | What |
|---|---|---|
| 0000 | `0000_init.sql` | Full schema (13 tables, 2 enums, indexes, FKs) |
| 0001 | `0001_enable_rls.sql` | RLS on every table (no policies = deny-all) |
| 0002 | `0002_revoke_postgrest_grants.sql` | Revoke anon/authenticated grants + default privileges |
| 0003 | `0003_auth_user_triggers.sql` | Profile-row creation, contact sync, role → JWT claim, backfill |
| 0004 | `0004_rate_limit_buckets.sql` | Rate limit counters table |
