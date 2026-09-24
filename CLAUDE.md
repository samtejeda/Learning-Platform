# Learning Platform — Project Context

## What this is
A mobile-first web learning platform similar to Blackboard. Students watch video lectures, complete exams and assignments, and participate in forums. Professors create content and grade work. Admins manage the platform.

## Current deployment context
The first real deployment of this platform is for a **Bible academy**. That's a client/tenant decision, not an architectural one: naming, schema, routes, and branding stay generic (`courses`, `lectures`, `professor`, not devotional-specific terms) so the same codebase can be reused as a template for other institutions later. Devotional/theological content is just course content from the platform's point of view.

Two things this context does change, regardless of branding:
- **Minors.** Some students at a church academy may be minors. Err conservative on data collection, default visibility, and access control anywhere student PII or activity data is involved. Treat this as a "stop and ask Sam" trigger, not a judgment call to make solo — see `ORCHESTRATION.md`.
- **Doctrinal content.** Any wording with a theological/doctrinal dimension (e.g. comprehension-question answer keys, forum moderation policy) is a "stop and ask Sam" trigger, not something to author or resolve unilaterally.

## Build orchestration
This project is being built with a multi-agent, minimal-check-in workflow. See:
- `ORCHESTRATION.md` — the working method, priority order, model handoff, and the 6 named build agents
- `PROGRESS.md` — current source of truth for what's done / in progress / next / open questions (read this before resuming work in a new session)
- `audit-prompts/` — 13 pass/fail audit checklists (definition-of-done, not build instructions) each build agent re-reads from disk and scores its own work against regularly, not just once
- `.claude/agents/` — the 6 build agent definitions, plus `supervising-agent.md`: the non-building supervisor role (PR triage, conflict resolution, "what needs Sam" reporting, external-service setup, PROGRESS.md upkeep). To start or resume that role in any session: "Follow the instructions for the supervising agent in `.claude/agents/supervising-agent.md`."
- `API.md` — inventory of every route handler and server action, plus the conventions they follow (update in the same commit as any new endpoint)

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router) + TypeScript | Fullstack — frontend + API routes in one repo. Next 16 renamed `middleware.ts` to `proxy.ts`; see Project Structure below. |
| Database | Supabase (Postgres) | Also handles Auth and Storage |
| ORM | Drizzle ORM | Type-safe, pairs well with Supabase Postgres |
| Auth | Supabase Auth | Email+password and phone OTP (Twilio integration) |
| Storage | Supabase Storage | Video files, assignment uploads, readings |
| SMS/OTP | Twilio Verify (via Supabase Auth) | Phone-based OTP sign-in |
| Deployment | Vercel | |
| Error tracking | Sentry (free tier, `@sentry/nextjs`) | Approved by Sam 2026-09-18. PII off, no Replay/tracing, payloads scrubbed in `lib/sentry/`, source maps uploaded privately. A no-op without a DSN. See `docs/RUNBOOK.md`. |

## User Roles

- **Student** — watches lectures, submits assignments, takes exams, posts in forums
- **Professor** — creates all course content, grades assignments and exams, views student progress
- **Admin** — manages professors and students platform-wide, through the app itself, not the database. Exact feature set TBD, but the requirement is fixed: this app is meant to be sold or donated as an independent, self-hosted template for other institutions, each running their own deployment with no ongoing support from Sam — so admin must be real in-app tooling (role management, account oversight) before any redistribution, not a permanent "ask a developer to run SQL" situation. For Sam's own church deployment, SQL-based role promotion during build-out is fine and isn't blocking other work — see `PROGRESS.md`.

All role checks happen **server-side only**. Never trust the client for permission decisions.

## Feature Overview

### Courses
- A course has sections that appear only when content exists: Lectures, Syllabus, Exams, Assignments, Course Materials
- Students can be enrolled in multiple courses
- Main dashboard shows enrolled courses; clicking opens all course content

### Lectures (Videos)
- Videos stored in Supabase Storage, served via signed URLs
- Custom HTML5 video player — no native controls exposed
- Anti-scrubbing enforcement: server tracks per-student watch progress; a lecture is only marked "complete" when >= 95% has been genuinely watched (server validates, not frontend)
- Optional end-of-lecture comprehension question (per-course setting by professor)
- **Encode target: 720p H.264, ~1.5-2 Mbps.** Decided 2026-09-24 based on real catalog sizing (36 courses × ~4 lectures × 45 min): at this bitrate, total video stays comfortably under Supabase's included 100GB (Pro plan); 1080p or higher pushes the catalog to 150-250GB+ for no real benefit on talking-head/slide lecture content viewed on mobile. See `PROGRESS.md` ("Decisions & assumptions") for the full math.
- **A CDN must sit in front of signed-URL video delivery** (Supabase's own Storage CDN, or a Cloudflare proxy) before real-launch traffic. This is launch-blocking, not a performance nice-to-have: storage overage on Supabase is cheap (~$0.021/GB/month), but egress is not (~$0.09/GB past the included 250GB/month), and every lecture view pulls the full file — rewatching across even a few dozen students blows past egress long before storage is the constraint. **Cache-key requirement:** lecture URLs are per-request signed tokens (`lib/storage/`), so the CDN's cache key must be the underlying object path with the signed token/query string stripped — caching on the full URL (token included) yields a 0% hit rate since every request looks like a different resource. The signed-URL check still gates whether a request is allowed through; the CDN serves cached bytes only after that check passes.

### Syllabus
- One PDF per course, stored in the private `course-files` Storage bucket at a fixed, deterministic path (re-uploading replaces it in place)
- **No publish step** — uploading it makes it visible to students immediately (asymmetric with Course Materials on purpose)
- Renders inline via `<iframe>` on the course page, plus an "Open in new tab" fallback link (some mobile in-app browsers don't render PDFs inline)

### Course Materials
- A list of general, course-level resources not tied to any one lecture: an uploaded file (PDF, document, image, or video) or an external link
- Each item gets a **draft/publish step**, same as lectures — a professor stages an item, then explicitly publishes it before students see it (link-kind items are created complete in one step but still start unpublished)
- Files live in the private `course-files` Storage bucket, served via signed URLs, same as lecture videos; links are rendered as a plain outbound link, never fetched or proxied server-side

### Exams
- Question types: Multiple choice, True/False, Fill in the blank, Short essay (written text)
- Exams are NOT auto-graded — professor grades manually
- Section only appears in UI when an exam has been published

### Assignments
- Not in every course — section only appears when assignments exist
- Professors grade assignments manually

### Forum
- Questions can be posted from within a specific lecture
- Posts are visible at the course level (and potentially platform-wide — TBD)
- Professors and students both can reply

### Auth Flows
- Sign in: email + password **or** phone number + OTP code
- Password reset via email link
- Phone OTP means students who forget their password can still access via phone

## Project Structure

Route groups don't appear in URLs, so each role's surface gets a distinct URL prefix. Students (the primary mobile audience) get the unprefixed URLs; professors and admins get prefixes the proxy can gate on.

| Role | URLs | Route group |
|---|---|---|
| Student | `/dashboard`, `/courses/[courseId]`, … | `app/(student)/` |
| Professor (and admin) | `/professor`, `/professor/courses/[courseId]`, … | `app/(professor)/professor/` |
| Admin | `/admin`, … | `app/(admin)/admin/` |
| Signed out | `/login`, `/register`, `/reset-password`, `/resend-confirmation` | `app/(auth)/` |
| Recovery session | `/update-password` | `app/(auth)/` |

```
/
├── app/
│   ├── page.tsx                # "/" redirects: signed-out → /login, else role home
│   ├── (auth)/                 # login, register, reset-password, resend-confirmation, update-password
│   ├── (student)/              # layout: requireUser()
│   │   ├── dashboard/
│   │   └── courses/[courseId]/
│   ├── (professor)/professor/  # layout: requireRole("professor","admin")
│   │   ├── courses/[courseId]/
│   │   └── materials/[materialId]/edit/
│   ├── (admin)/admin/          # layout: requireRole("admin")
│   └── api/                    # Route handlers — only for non-form traffic (see API.md)
│       ├── auth/callback/      # PKCE code exchange for email links
│       ├── lectures/[lectureId]/{stream,progress}/  # signed video URL; server-validated watch progress
│       ├── courses/[courseId]/syllabus/  # signed syllabus PDF URL
│       └── course-materials/[materialId]/  # signed material file URL (file kind only)
├── components/
│   ├── ui/                     # Button, SubmitButton, Input, Field, Card, Alert
│   ├── app-shell.tsx           # Authenticated chrome (nav + sign-out)
│   ├── course-form.tsx, roster-manager.tsx, lecture-upload-form.tsx, lecture-list-manager.tsx  # plain professor UI
│   ├── syllabus-manager.tsx, syllabus-viewer.tsx  # upload/replace/remove; inline <iframe> + "open in new tab"
│   ├── course-material-form.tsx, course-materials-manager.tsx, course-materials-list.tsx  # plain professor + student UI
│   ├── course-files/           # use-signed-file-url.ts: shared client hook for the two signed-URL routes above
│   ├── video-player/           # lecture-player.tsx: no native controls, seeks only into server-accepted ranges
│   ├── exam-builder/           # (next phase)
│   └── forum/                  # (next phase)
├── lib/
│   ├── db/                     # Drizzle schema + client
│   ├── data/                   # Query functions; each takes the acting user id and encodes permission in the query
│   ├── courses/, enrollments/, lectures/, syllabus/, course-materials/  # actions.ts per domain (server actions)
│   ├── progress/               # policy.ts: pure anti-scrub rules (merge intervals, wall-clock bound, completion)
│   ├── storage/                # Service-role Supabase Storage client (signed URLs only, two buckets: lectures, course-files) + pure path/MIME helpers
│   ├── supabase/               # Supabase client helpers (server / client)
│   ├── auth/                   # actions.ts (server actions), session.ts (getCurrentUser/require*/assert*), roles.ts (pure path/role rules)
│   ├── validation/             # zod schemas + parseFormData
│   ├── rate-limit/             # Postgres-backed limiter
│   ├── logger.ts               # Structured JSON logger (use this, never console.*); `error` level also goes to Sentry
│   ├── logging/                # Pure redaction + log-line formatting (shared with Sentry scrubbing)
│   ├── health/                 # Dependency probes behind GET /api/health
│   ├── sentry/                 # Shared init options, event/breadcrumb scrubbing, client-error reporter
│   └── api/                    # respond.ts: JSON error helpers + same-origin guard for route handlers
├── test/                       # Integration-test harness (stubs, dev-only seed accounts) — see pnpm test:integration
├── scripts/backup/             # Encrypted dump + restore-test (run by .github/workflows/backup.yml)
├── docs/RUNBOOK.md             # Failure scenarios, rollback, backup drills
├── drizzle/                    # Versioned SQL migrations + meta (committed)
├── proxy.ts                    # Gate 1: session + role-prefix redirect (Next.js 16 renamed middleware.ts → proxy.ts)
└── drizzle.config.ts
```

### Authorization chain (three gates)
1. **`proxy.ts`** — runs on every request. Verifies the JWT, redirects signed-out users to `/login?next=…`, and bounces users whose token role doesn't match the path prefix (`/professor/*`, `/admin/*`). Convenience only; the role claim can lag a DB change by one token refresh.
2. **Route-group layouts** — `requireUser()` / `requireRole(...)` from `lib/auth/session.ts`, which verify the session with the auth server and read the role from the `users` table.
3. **Every page, server action, and route handler** calls `requireUser`/`requireRole` (pages) or `assertUser`/`assertRole` (actions/handlers) itself, and every `lib/data/*` function takes the acting user's id and enforces enrollment/ownership inside the query. Layouts don't re-run on sibling navigation, so gate 2 alone is never enough.

### Data access model
All reads and writes go through Drizzle server-side. Every table has RLS enabled with no policies and PostgREST grants revoked (`drizzle/0001`, `0002`), so the Supabase REST API with the anon key is a wall, not a data path. The `public.users` row is created by a trigger on `auth.users` (`drizzle/0003`); app code never inserts it. `users.role` is mirrored into the JWT's `app_metadata.role` by trigger. Course invitations become enrollments by trigger when a matching account appears (`drizzle/0006`).

**Storage:** two private buckets, `lectures` and `course-files` (syllabus PDFs + course material files), both with no storage policies. `lib/storage/` holds the only use of `SUPABASE_SERVICE_ROLE_KEY`, and uses it exclusively to sign upload/stream URLs, check that an uploaded object exists, and delete objects — after the calling action/handler has verified ownership or enrollment. It is never used for database queries. Browsers upload directly to Storage with a one-time signed token for a server-chosen path (syllabus uses a fixed, deterministic path so re-uploads replace it in place); nothing large passes through Next.js.

## API Security Rules (non-negotiable)

These come from explicit project requirements — do not compromise on them:

1. **Never trust the frontend** — every API route must verify the user's identity and role server-side, regardless of what the UI shows or hides
2. **Broken access control** — always check that the authenticated user owns or has permission to access the resource being requested
3. **Business logic** — validate the full flow, not just individual endpoints (e.g., can't submit exam answers if exam isn't open/published)
4. **No blind trust of external APIs** — validate tokens and responses from Supabase Auth and Twilio; don't assume they can't be spoofed
5. **Rate limiting** — all auth endpoints (login, OTP send, OTP verify) must be rate-limited
6. **Input validation** — all user input must be validated and sanitized server-side before hitting the database
7. **Minimal response data** — API routes return only what the client needs; never expose passwords, tokens, internal IDs beyond what's required
8. **SSRF prevention** — never make server-side HTTP requests based on unvalidated user input
9. **API inventory** — every route must be documented in `API.md`; no orphaned/test routes left in production
10. **Security misconfiguration** — no debug mode in prod, no default credentials, keep dependencies updated

## Database Design Notes

Key tables to plan:
- `users` (id, email, phone, role, created_at)
- `courses` (id, title, description, professor_id, syllabus_storage_path, syllabus_uploaded_at)
- `enrollments` (student_id, course_id)
- `lectures` (id, course_id, title, video_url, order, completion_threshold)
- `lecture_progress` (student_id, lecture_id, watched_seconds, completed, last_updated)
- `course_materials` (id, course_id, kind [file|link], title, description, storage_path, mime_type, url, order, uploaded_at, published_at)
- `exams` (id, course_id, title, published_at)
- `exam_questions` (id, exam_id, type, prompt, options_json, order)
- `exam_submissions` (id, exam_id, student_id, submitted_at)
- `exam_answers` (id, submission_id, question_id, answer_text)
- `assignments` (id, course_id, title, description, due_date)
- `assignment_submissions` (id, assignment_id, student_id, file_url, grade, feedback)
- `forum_posts` (id, lecture_id, course_id, author_id, body, created_at)
- `forum_replies` (id, post_id, author_id, body, created_at)

## Mobile-First
Primary target is phone users. Design and test mobile layouts first. Desktop is secondary but equally important.

## Development Commands
```
pnpm dev          # start dev server
pnpm build        # production build
pnpm lint         # eslint
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest (unit tests under lib/**)
pnpm build:vercel # Vercel's build command: migrate (production only) then build
pnpm db:generate  # diff lib/db/schema.ts against drizzle/meta and write a new migration
pnpm db:migrate   # apply pending migrations in drizzle/ (run before every deploy)
pnpm db:check     # verify drizzle/ migrations + snapshots are consistent
pnpm db:studio    # open Drizzle Studio
```

Migrations are versioned in `drizzle/` and committed (including `drizzle/meta/`). There is deliberately no `db:push` script: push applies schema changes without recording them in the journal and desyncs the DB from `drizzle/`. Schema change workflow: edit `lib/db/schema.ts` → `pnpm db:generate` → review the SQL → commit → `pnpm db:migrate`. For SQL that Drizzle can't model (grants, triggers, functions) use `pnpm drizzle-kit generate --custom --name=<slug>` and write the SQL by hand.

### CI and deployment
- **Branch strategy: nothing goes to `main` directly, ever** — not build agents, not Sam's own interactive sessions, no exceptions. All work (including docs-only changes) happens on its own branch (`git checkout -b <type>/<slug>`) and lands via pull request; parallel work via worktrees branches automatically either way. Every branch stops for Sam's review/merge — no self-merging to `main`. This is what `audit-prompts/cicd-and-version-control.md`'s "branch strategy" item checks for. (In effect since 2026-09-18; see `PROGRESS.md`.)
- **CI** (`.github/workflows/ci.yml`): every PR and push to `main` runs lint, typecheck, unit tests, `db:check`, and `build` (placeholder env, no secrets). `main` is branch-protected on the `checks` job.
- **Deploy**: Vercel, connected to the GitHub repo. Merge to `main` → production; every PR → preview URL. `vercel.json` sets the build command to `pnpm build:vercel`, which applies pending migrations **only when `VERCEL_ENV=production`** (needs `DIRECT_URL` in Production scope; never set it in Preview), then builds. A failed migration fails the deploy and the previous one stays live.
- **Rollback**: Vercel → Deployments → previous deployment → Instant Rollback. Migrations are forward-only; a rollback reverts code, not schema, so write migrations backward-compatible with the previous deploy.
