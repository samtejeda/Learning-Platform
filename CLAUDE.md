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
- `.claude/agents/` — the 6 build agent definitions
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

## User Roles

- **Student** — watches lectures, submits assignments, takes exams, posts in forums
- **Professor** — creates all course content, grades assignments and exams, views student progress
- **Admin** — manages professors and students platform-wide, through the app itself, not the database. Exact feature set TBD, but the requirement is fixed: this app is meant to be sold or donated as an independent, self-hosted template for other institutions, each running their own deployment with no ongoing support from Sam — so admin must be real in-app tooling (role management, account oversight) before any redistribution, not a permanent "ask a developer to run SQL" situation. For Sam's own church deployment, SQL-based role promotion during build-out is fine and isn't blocking other work — see `PROGRESS.md`.

All role checks happen **server-side only**. Never trust the client for permission decisions.

## Feature Overview

### Courses
- A course has sections that appear only when content exists: Lectures, Syllabus, Exams, Assignments, Readings
- Students can be enrolled in multiple courses
- Main dashboard shows enrolled courses; clicking opens all course content

### Lectures (Videos)
- Videos stored in Supabase Storage, served via signed URLs
- Custom HTML5 video player — no native controls exposed
- Anti-scrubbing enforcement: server tracks per-student watch progress; a lecture is only marked "complete" when >= 95% has been genuinely watched (server validates, not frontend)
- Optional end-of-lecture comprehension question (per-course setting by professor)

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
| Signed out | `/login`, `/register`, `/reset-password` | `app/(auth)/` |
| Recovery session | `/update-password` | `app/(auth)/` |

```
/
├── app/
│   ├── page.tsx                # "/" redirects: signed-out → /login, else role home
│   ├── (auth)/                 # login, register, reset-password, update-password
│   ├── (student)/              # layout: requireUser()
│   │   ├── dashboard/
│   │   └── courses/[courseId]/
│   ├── (professor)/professor/  # layout: requireRole("professor","admin")
│   │   └── courses/[courseId]/
│   ├── (admin)/admin/          # layout: requireRole("admin")
│   └── api/                    # Route handlers — only for non-form traffic (see API.md)
│       ├── auth/callback/      # PKCE code exchange for email links
│       └── lectures/[lectureId]/{stream,progress}/  # signed video URL; server-validated watch progress
├── components/
│   ├── ui/                     # Button, SubmitButton, Input, Field, Card, Alert
│   ├── app-shell.tsx           # Authenticated chrome (nav + sign-out)
│   ├── course-form.tsx, roster-manager.tsx, lecture-upload-form.tsx, lecture-list-manager.tsx  # plain professor UI
│   ├── video-player/           # lecture-player.tsx: no native controls, seeks only into server-accepted ranges
│   ├── exam-builder/           # (next phase)
│   └── forum/                  # (next phase)
├── lib/
│   ├── db/                     # Drizzle schema + client
│   ├── data/                   # Query functions; each takes the acting user id and encodes permission in the query
│   ├── courses/, enrollments/, lectures/  # actions.ts per domain (server actions)
│   ├── progress/               # policy.ts: pure anti-scrub rules (merge intervals, wall-clock bound, completion)
│   ├── storage/                # Service-role Supabase Storage client (signed URLs only) + pure path/MIME helpers
│   ├── supabase/               # Supabase client helpers (server / client)
│   ├── auth/                   # actions.ts (server actions), session.ts (getCurrentUser/require*/assert*), roles.ts (pure path/role rules)
│   ├── validation/             # zod schemas + parseFormData
│   ├── rate-limit/             # Postgres-backed limiter
│   └── api/                    # respond.ts: JSON error helpers + same-origin guard for route handlers
├── test/                       # Integration-test harness (stubs, dev-only seed accounts) — see pnpm test:integration
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

**Storage:** the `lectures` bucket is private with no storage policies. `lib/storage/` holds the only use of `SUPABASE_SERVICE_ROLE_KEY`, and uses it exclusively to sign upload/stream URLs, check that an uploaded object exists, and delete objects — after the calling action/handler has verified ownership or enrollment. It is never used for database queries. Browsers upload directly to Storage with a one-time signed token for a server-chosen path; nothing large passes through Next.js.

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
- `courses` (id, title, description, professor_id)
- `enrollments` (student_id, course_id)
- `lectures` (id, course_id, title, video_url, order, completion_threshold)
- `lecture_progress` (student_id, lecture_id, watched_seconds, completed, last_updated)
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
pnpm test         # vitest (unit tests under lib/**)
pnpm test:integration  # lib/**/*.integration.test.ts against the DB in .env.local (seeds dev-only @example.test accounts; never point at prod)
pnpm test:http    # test/http/*.http.test.ts against a RUNNING server (pnpm build && pnpm start -p 3111): real sessions, proxy, Storage
pnpm db:generate  # diff lib/db/schema.ts against drizzle/meta and write a new migration
pnpm db:migrate   # apply pending migrations in drizzle/ (run before every deploy)
pnpm db:check     # verify drizzle/ migrations + snapshots are consistent
pnpm db:studio    # open Drizzle Studio
```

Migrations are versioned in `drizzle/` and committed (including `drizzle/meta/`). There is deliberately no `db:push` script: push applies schema changes without recording them in the journal and desyncs the DB from `drizzle/`. Schema change workflow: edit `lib/db/schema.ts` → `pnpm db:generate` → review the SQL → commit → `pnpm db:migrate`. For SQL that Drizzle can't model (grants, triggers, functions) use `pnpm drizzle-kit generate --custom --name=<slug>` and write the SQL by hand.
