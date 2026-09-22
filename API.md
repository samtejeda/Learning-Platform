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

Proxy (`proxy.ts`) allows `/api/auth/*` through without a session; every other `/api/*` path requires one before the handler runs, and the handler checks again. A signed-out `/api/*` call gets the JSON `401` `{ "error": { "code": "unauthenticated", "message": "Please sign in." } }` straight from the proxy (verified over HTTP) — never a redirect to the login page, which a `fetch` client would follow and mistake for success. Signed-out *page* requests still redirect to `/login?next=…`.

Tests that back these conventions: `pnpm test` (pure logic), `pnpm test:integration` (real DB + real Storage, Next plumbing stubbed), `pnpm test:http` (running server, real sessions and proxy).

## Route handlers

| Method + path | Auth | Rate limit | Input | Output | Notes |
|---|---|---|---|---|---|
| `GET /api/auth/callback` | Public | Supabase's own (code is single-use) | `?code`, `?next` (sanitised by `safeNextPath`) | 302 to `next`, or `/login?error=link` | Exchanges PKCE code for a session cookie. Used by sign-up confirmation and password-reset emails. Never echoes the code. |
| `GET /api/lectures/[lectureId]/stream` | `assertUser` + `getLectureForViewer` (student: enrolled **and** published; owning professor/admin: any status) | `lecture_progress` / user id (60/min) + IP (300/min) | path id (`uuidSchema`) | `{ url, expiresAt }` (15-min signed URL), `Cache-Control: no-store` | Not-enrolled, unpublished, and unknown ids are all 404. 503 `storage_unavailable` if signing fails. |
| `POST /api/lectures/[lectureId]/progress` | `isSameOrigin` (403) → `assertUser` → enrollment + published inside `recordProgress` | `lecture_progress` / user id + IP | JSON `progressSegmentSchema` `{ from, to, position? }` (strict; seconds) | `{ accepted, percent, completed, watchedSeconds, intervals, justCompleted }` | Server merges the segment into watched ranges under `lib/progress/policy.ts`: >20 s or malformed → 400; faster-than-wall-clock → 200 `{ accepted:false, reason:"too_fast" }` (ignored, not credited); no duration yet → 409. Row locked `FOR UPDATE` in a transaction. Professors previewing get 404 (no progress recorded). |

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

## Server actions (`lib/courses/actions.ts`)

| Action | Auth | Rate limit | Schema | On success | Notes |
|---|---|---|---|---|---|
| `createCourse(prev, fd)` | `assertRole("professor","admin")` | — | `courseFormSchema` (`title` 1–120, `description` ≤ 2000 → null if empty) | `redirect(/professor/courses/<id>)` | `professorId` is always the acting user; never taken from the form. |
| `updateCourse(courseId, prev, fd)` | `assertRole("professor","admin")` | — | `uuidSchema` on the bound id + `courseFormSchema` | `redirect(/professor/courses/<id>)` | Bound id is untrusted: validated, then `findOwnedCourse` + ownership in the UPDATE's WHERE. Not-owned = "Course not found." (same as not-found). |

## Server actions (`lib/enrollments/actions.ts`)

All take a bound `courseId` (untrusted: `uuidSchema`, then `findOwnedCourse`) and return `ActionState`. Not-owned and not-found both yield "Course not found."

| Action | Auth | Rate limit scope / identifier | Schema | On success | Notes |
|---|---|---|---|---|---|
| `inviteStudent(courseId, prev, fd)` | `assertRole("professor","admin")` + course ownership | `invite` / acting user id (40/h) + IP (60/h) | `inviteSchema` (`email`, normalised lowercase) | `{ success }` — "now enrolled" / "invited" / "already on the roster" | One transaction: existing account → `enrollments` row now + invitation marked accepted; unknown email → `course_invitations` row, activated by the `on_public_user_email_set` trigger on signup. Idempotent. |
| `removeStudent(courseId, prev, fd)` | same | — | `removeStudentSchema` (`studentId`) | `{ success }` | Deletes the enrollment and the accepted invitation so a re-invite works. |
| `revokeInvitation(courseId, prev, fd)` | same | — | `revokeInvitationSchema` (`invitationId`) | `{ success }` | Only pending (unaccepted) invitations of that course. |

## Server actions (`lib/lectures/actions.ts`)

Upload flow: **1** `createLecture` (row + one-time signed token for a *server-chosen* path) → **2** browser `supabase.storage.from(bucket).uploadToSignedUrl(path, token, file)` straight to Storage (no server hop, no Vercel body limit) → **3** `finalizeLectureUpload` (server confirms the object exists with an allowlisted content type, records duration) → **4** `publishLecture`. Every step re-validates ids and re-checks ownership via `getOwnedLecture` (joins the course's `professor_id`; admins bypass). Not-owned = not-found = "Lecture not found."

| Action | Auth | Schema | Returns | Notes |
|---|---|---|---|---|
| `createLecture(courseId, input)` | `assertRole("professor","admin")` + `findOwnedCourse` | `createLectureSchema` (`title`, `description`, `contentType` ∈ mp4/webm/mov, `sizeBytes` ≤ 2 GiB) | `UploadTicket` `{ ok, lectureId, bucket, path, token }` or `{ ok:false, error, fieldErrors? }` | Path is `courses/<courseId>/lectures/<lectureId>/video.<ext>`, ids server-generated. Row is `pending_upload` until finalized. Storage failure leaves the row for retry. |
| `retryLectureUpload(lectureId)` | owner | `uuidSchema` | `UploadTicket` | Only while `video_uploaded_at` is null. |
| `finalizeLectureUpload(lectureId, input)` | owner | `finalizeLectureSchema` (`durationSeconds` 1–86400) | `ActionState` | `getObjectInfo(path)` must exist; a non-video content type at the path is removed and refused. Duration comes from the professor's browser (their own content); students never influence it. |
| `publishLecture(lectureId)` / `unpublishLecture(lectureId)` | owner | `uuidSchema` | `ActionState` | Publish requires `video_uploaded_at` (enforced in the UPDATE's WHERE too). |
| `updateLecture(lectureId, prev, fd)` | owner | `lectureFormSchema` | `redirect(course page)` | Title/description only. |
| `reorderLectures(courseId, input)` | owner of course | `reorderLecturesSchema` (unique uuids, ≤ 500) | `ActionState` | The list must cover exactly the course's lectures; applied in one transaction or not at all. |
| `deleteLecture(lectureId)` | owner | `uuidSchema` | `ActionState` | Removes the Storage object first (logged if that fails), then the row (progress cascades). |

## Pages with data access (for completeness; not APIs)

Pages are gated three times: proxy prefix rule → route-group layout (`requireUser`/`requireRole`) → the page itself, plus the query. See CLAUDE.md "Authorization chain".

| Page | Requires | Data function (enforces) |
|---|---|---|
| `/` | — | redirects by role or to `/login` |
| `/dashboard` | any signed-in user | `listEnrolledCourses(userId)` |
| `/courses/[courseId]` | any signed-in user | `getCourseForStudent(courseId, userId)` (enrollment; 404 otherwise; **published** lectures only, with the student's own progress) |
| `/courses/[courseId]/lectures/[lectureId]` | any signed-in user | `getLectureForViewer(lectureId, actor)` (enrolled + published, or course owner preview; lecture must belong to `courseId`; 404 otherwise). Renders `components/video-player/lecture-player.tsx`, which calls the two `/api/lectures/*` handlers. |
| `/professor` | professor, admin | `listTaughtCourses(userId)` / admin: `listAllCourses()` |
| `/professor/courses/new` | professor, admin | — (form → `createCourse`) |
| `/professor/courses/[courseId]` | professor, admin | `getCourseForProfessor(courseId, actor)` (ownership; 404 otherwise; all lectures with status + roster) |
| `/professor/courses/[courseId]/edit` | professor, admin | `getCourseForProfessor` (form → `updateCourse`) |
| `/professor/lectures/[lectureId]/edit` | professor, admin | `getOwnedLecture(lectureId, actor)` (ownership via course join; form → `updateLecture`) |
| `/admin` | admin | placeholder |

## Environment variables

| Variable | Used by | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase clients, proxy, CSP | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase clients, proxy | yes |
| `NEXT_PUBLIC_SITE_URL` | `lib/env.ts` for email links | yes in production |
| `DATABASE_URL` | Drizzle at runtime (transaction pooler, 6543) | yes |
| `DIRECT_URL` | drizzle-kit only (session pooler, 5432) | for migrations |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/storage` **only** — signed upload/stream URLs, object checks, deletes on the private `lectures` bucket | yes (lectures) |

The service-role key is server-only and is used exclusively for Storage (decision 2026-09-18). It is never used for database access: all data goes through Drizzle on the table-owner connection so app-layer authorization always applies, and PostgREST is fully denied (see `drizzle/0002`). The bucket has no storage policies, so the browser can only ever act on a URL the server signed after checking ownership/enrollment.

## Migrations

`drizzle/` is the versioned history. Workflow: edit `lib/db/schema.ts` → `pnpm db:generate` → review → commit → `pnpm db:migrate` (production deploys run it automatically: `vercel.json` → `pnpm build:vercel` → `scripts/vercel-build.sh`, Production scope only; a failed migration fails the build and the previous deployment stays live. CI runs `pnpm db:check` on every PR). Custom SQL (grants, triggers): `pnpm exec dotenv -e .env.local -- drizzle-kit generate --custom --name=<slug>`.

| # | File | What |
|---|---|---|
| 0000 | `0000_init.sql` | Full schema (13 tables, 2 enums, indexes, FKs) |
| 0001 | `0001_enable_rls.sql` | RLS on every table (no policies = deny-all) |
| 0002 | `0002_revoke_postgrest_grants.sql` | Revoke anon/authenticated grants + default privileges |
| 0003 | `0003_auth_user_triggers.sql` | Profile-row creation, contact sync, role → JWT claim, backfill |
| 0004 | `0004_rate_limit_buckets.sql` | Rate limit counters table |
| 0005 | `0005_invitations_lecture_lifecycle.sql` | `course_invitations` table; lecture `description`/`duration_seconds`/`video_uploaded_at`/`published_at`; progress `watched_intervals`/`last_position_seconds`/`completed_at` |
| 0006 | `0006_invitation_trigger_lectures_bucket.sql` | `on_public_user_email_set` trigger (invitation → enrollment on signup); private `lectures` Storage bucket with size cap + video MIME allowlist |
