# Progress

Source of truth for where this project actually stands. Read this before resuming work in a new session — trust this over assumptions in `CLAUDE.md`'s narrative sections, since code moves faster than docs.

Last reconciled: 2026-09-16.

## Done
- Drizzle schema (`lib/db/schema.ts`) covering users, courses, enrollments, lectures, lecture_progress, exams, exam_questions, exam_submissions, exam_answers, assignments, assignment_submissions, forum_posts, forum_replies, with relations wired up.
- Supabase client helpers (`lib/supabase/client.ts`, `lib/supabase/server.ts`).
- Auth server actions (`lib/auth/actions.ts`): email+password sign-in, phone OTP send/verify, sign-up (creates matching row in `users` with role `student`), password reset request, sign-out.
- Auth pages scaffolded: `app/(auth)/login`, `register`, `reset-password` (+ layout).
- Route groups scaffolded for all three roles: `app/(student)`, `app/(professor)`, `app/(admin)` (dashboard/courses subroutes present, not yet confirmed built out — inventory this before assuming content exists).
- Basic authentication gate in `proxy.ts` (Next.js 16's renamed `middleware.ts`): redirects unauthenticated users to `/login` for any non-public route.

## In progress
- Role-based route protection: `proxy.ts` currently treats "logged in" and "authorized" as the same thing. It does not check `role` against the `(student)/(professor)/(admin)` route group being accessed. This needs to happen before any of those routes hold real content.
- API route handlers under `app/api/{auth,courses,lectures,exams,assignments,forum}/` exist as directories but weren't inventoried file-by-file this session — confirm what's actually implemented vs. empty before assuming coverage.

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
