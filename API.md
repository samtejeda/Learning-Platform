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

Proxy (`proxy.ts`) allows `/api/auth/*` and `/api/health` through without a session; every other `/api/*` path requires one before the handler runs, and the handler checks again. A signed-out `/api/*` call gets the JSON `401` `{ "error": { "code": "unauthenticated", "message": "Please sign in." } }` straight from the proxy (verified over HTTP) — never a redirect to the login page, which a `fetch` client would follow and mistake for success. Signed-out *page* requests still redirect to `/login?next=…`.

Tests that back these conventions: `pnpm test` (pure logic), `pnpm test:integration` (real DB + real Storage, Next plumbing stubbed), `pnpm test:http` (running server, real sessions and proxy).

## Route handlers

| Method + path | Auth | Rate limit | Input | Output | Notes |
|---|---|---|---|---|---|
| `GET /api/auth/callback` | Public | Supabase's own (code is single-use) | `?code`, `?next` (sanitised by `safeNextPath`) | 302 to `next`, or `/login?error=link` | Exchanges PKCE code for a session cookie. Used by sign-up confirmation and password-reset emails. Never echoes the code. |
| `GET /api/health` | Public (uptime monitors have no session) | None needed: probe results are cached ~10s per instance, so dependency load is bounded regardless of callers | none | `200 {status:"ok"}` or `503 {status:"degraded", checks:{database, auth}}` (values `ok`/`fail`) | Checks Postgres (`select 1`) and Supabase Auth's health endpoint, 3s timeout each. URL comes from env, never request input. No versions, timings, hosts or error text. `Cache-Control: no-store`. Twilio has no direct probe (only reachable via Supabase Auth). |
| `GET /icon.svg` | Public (browsers fetch it signed out; `proxy.ts` matcher skips `.svg`) | None needed: static response, no input, no DB | none | `200` SVG favicon | Drawn from the active color palette (`COLOR_PALETTE`) so the icon matches the brand. Contains no user data. Replaces the old static `public/icon.svg`. |
| `GET /api/lectures/[lectureId]/stream` | `assertUser` + `getLectureForViewer` (student: enrolled **and** published; owning professor/admin: any status) | `lecture_progress` / user id (60/min) + IP (300/min) | path id (`uuidSchema`) | `{ url, expiresAt }` (15-min URL: a Worker URL when `VIDEO_CDN_URL` is set, else the Supabase signed URL), `Cache-Control: no-store` | Not-enrolled, unpublished, and unknown ids are all 404. 503 `storage_unavailable` if signing fails. |
| `POST /api/lectures/[lectureId]/progress` | `isSameOrigin` (403) → `assertUser` → enrollment + published inside `recordProgress` | `lecture_progress` / user id + IP | JSON `progressSegmentSchema` `{ from, to, position? }` (strict; seconds) | `{ accepted, percent, completed, watchedSeconds, intervals, justCompleted }` | Server merges the segment into watched ranges under `lib/progress/policy.ts`: >20 s or malformed → 400; faster-than-wall-clock → 200 `{ accepted:false, reason:"too_fast" }` (ignored, not credited); no duration yet → 409. Row locked `FOR UPDATE` in a transaction. Professors previewing get 404 (no progress recorded). |
| `GET /api/courses/[courseId]/syllabus` | `assertUser` + `getSyllabusForViewer` (student: enrolled **and** a syllabus exists; owning professor/admin: any time one exists) | `course_file` / user id (30/min) + IP (120/min) | path id (`uuidSchema`) | `{ url, expiresAt }` (30-min signed URL), `Cache-Control: no-store` | Not-enrolled, no-syllabus-yet, and unknown course ids are all 404. 503 `storage_unavailable` if signing fails. |
| `GET /api/course-materials/[materialId]` | `assertUser` + `getMaterialForViewer` (student: enrolled **and** published **and** kind='file'; owning professor/admin: any status, kind='file' only) | `course_file` / user id + IP | path id (`uuidSchema`) | `{ url, expiresAt }` (30-min signed URL), `Cache-Control: no-store` | Not-enrolled, unpublished, unknown, and **link-kind** materials are all 404 — a link has no server object; its `url` is already in the page data and rendered as a plain outbound `<a>`, never proxied or fetched server-side (no SSRF surface). 503 `storage_unavailable` if signing fails. |
| `PUT /api/exams/attempts/[attemptId]/answers` | `isSameOrigin` (403) → `assertUser` → the attempt must be the caller's own, caller still enrolled, exam published (all inside `saveAttemptAnswers`) | `exam_autosave` / user id (30/min) + IP (600/min) | path id (`uuidSchema`) + JSON `answersSchema` `{ answers: [{ questionId, selectedOption? \| answerText? \| blanks? }] }` (strict) | `{ saved: true, deadline }`, `Cache-Control: no-store` | Autosave for an in-progress attempt: replaces the saved answers with the posted set (partial is fine). Per-type checks run against the real question rows (position in range for the attempt's language, text length caps; a fill-in-the-blank question whose prompt has blanks takes `blanks: string[]` with exactly one entry per blank in the attempt's language, a zero-blank legacy fill question takes `answerText`). Deadline enforced here: past it the attempt is closed with what was already saved and the call returns 409 `expired`. 409 `already_submitted`. Not-yours/unknown/not-enrolled = 404. Response never includes keys. |

## Server actions (`lib/auth/actions.ts`)

All take `(prev: ActionState, formData)` unless noted. "Identifier" is the second rate-limit dimension (see `lib/rate-limit/policy.ts` for thresholds).

| Action | Auth | Rate limit scope / identifier | Schema | On success | Notes |
|---|---|---|---|---|---|
| `signInWithEmail` | Public | `login` / email | `signInSchema` | `redirect(next \| "/")` | Generic "Invalid email or password." on any auth error. `next` sanitised. |
| `sendPhoneOTP({ phone })` | Public | `otp_send` / phone | `sendOtpSchema` | `{ success, values.phone }` (E.164) | `shouldCreateUser: false`: OTP is sign-in only, cannot create accounts. Same message for unknown numbers. Each send costs an SMS. |
| `verifyPhoneOTP({ phone, token, next })` | Public | `otp_verify` / phone | `verifyOtpSchema` | `redirect(next \| "/")` | Generic "Invalid or expired code." |
| `signUp` | Public | `signup` / email | `signUpSchema` | `{ success }` | Role is always `student`; the `public.users` row is created by DB trigger. Existing email returns the same success message. `emailRedirectTo` → callback → `/dashboard`. |
| `resendConfirmation` | Public | `resend_confirmation` / email | `resendConfirmationSchema` | `{ success }` always | Never reveals whether the email exists, is unconfirmed, or is already confirmed — same message either way, matching `requestPasswordReset`'s pattern. Only Supabase's own `over_email_send_rate_limit` is surfaced distinctly (system state, not account-specific). `emailRedirectTo` → callback → `/dashboard`. |
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
| `createLecture(courseId, input)` | `assertRole("professor","admin")` + `findOwnedCourse` | `createLectureSchema` (`title`, `description`, `contentType` = `video/mp4`, `sizeBytes` ≤ 1 GiB) | `UploadTicket` `{ ok, lectureId, bucket, path, token }` or `{ ok:false, error, fieldErrors? }` | Path is `courses/<courseId>/lectures/<lectureId>/video.<ext>`, ids server-generated. Row is `pending_upload` until finalized. Storage failure leaves the row for retry. |
| `retryLectureUpload(lectureId)` | owner | `uuidSchema` | `UploadTicket` | Only while `video_uploaded_at` is null. |
| `finalizeLectureUpload(lectureId, input)` | owner | `finalizeLectureSchema` (`durationSeconds` 1–86400) | `ActionState` | `getObjectInfo(path)` must exist; a non-video content type at the path is removed and refused. Then the first 8 MiB is read through a server-signed URL and probed (`lib/video/mp4-probe.ts`): non-H.264, over 720p, over 3 Mbps or index-at-end (`lib/video/encode-policy.ts`) is removed and refused with a fix message; 2.25-3 Mbps is accepted with a note. Duration is the server-probed value; the client's `durationSeconds` is only validated. See `docs/ENCODING.md`. |
| `publishLecture(lectureId)` / `unpublishLecture(lectureId)` | owner | `uuidSchema` | `ActionState` | Publish requires `video_uploaded_at` (enforced in the UPDATE's WHERE too). |
| `updateLecture(lectureId, prev, fd)` | owner | `lectureFormSchema` | `redirect(course page)` | Title/description only. |
| `reorderLectures(courseId, input)` | owner of course | `reorderLecturesSchema` (unique uuids, ≤ 500) | `ActionState` | The list must cover exactly the course's lectures; applied in one transaction or not at all. |
| `deleteLecture(lectureId)` | owner | `uuidSchema` | `ActionState` | Removes the Storage object first (logged if that fails), then the row (progress cascades). |

## Server actions (`lib/syllabus/actions.ts`)

Upload flow: **1** `uploadSyllabus` (one-time signed token for the course's *fixed* `courses/<courseId>/syllabus.pdf` path — `upsert: true`, so a re-upload replaces it in place) → **2** browser `supabase.storage.from(bucket).uploadToSignedUrl(path, token, file)` → **3** `finalizeSyllabusUpload` (server confirms the object exists and is really a PDF, records it on the course row). **No publish step** — the course row is updated at finalize, so uploading makes it visible to students immediately (asymmetric with course materials on purpose, per Sam's decision). Every step re-validates the course id and re-checks ownership via `findOwnedCourse`. Not-owned = not-found = "Course not found."

| Action | Auth | Schema | Returns | Notes |
|---|---|---|---|---|
| `uploadSyllabus(courseId, input)` | `assertRole("professor","admin")` + `findOwnedCourse` | `uploadSyllabusSchema` (`contentType` must be `application/pdf`, `sizeBytes` ≤ 2 GiB) | `SyllabusUploadTicket` `{ ok, courseId, bucket, path, token }` or `{ ok:false, error, fieldErrors? }` | Path is always `courses/<courseId>/syllabus.pdf`. |
| `finalizeSyllabusUpload(courseId)` | owner | — | `ActionState` | `getCourseFileInfo(path)` must exist and be `application/pdf`; wrong content type is removed and refused. Records `syllabusStoragePath`/`syllabusUploadedAt` on the course row (visible to students from this point). |
| `removeSyllabus(courseId)` | owner | — | `ActionState` | Removes the Storage object first (logged if that fails), then clears the course row's syllabus columns. |

## Server actions (`lib/course-materials/actions.ts`)

General course-level resources: a file (PDF/doc/image/video) or an external link. Both kinds get a draft/publish step (per Sam's decision — asymmetric with the syllabus on purpose). File kind mirrors the lecture upload flow: **1** `createMaterial({kind:"file",…})` (pending row + one-time signed token for a *server-chosen* path) → **2** browser upload → **3** `finalizeMaterialUpload` (server confirms the object exists with an allowlisted content type) → **4** `publishMaterial`. Link kind is complete in one step — `createMaterial({kind:"link",…})` sets the URL immediately — but still starts unpublished. Every step re-validates its ids and re-checks ownership via `getOwnedMaterial` (joins the course's `professor_id`; admins bypass). Not-owned = not-found = "Material not found." (course-level actions use "Course not found.").

| Action | Auth | Schema | Returns | Notes |
|---|---|---|---|---|
| `createMaterial(courseId, input)` | `assertRole("professor","admin")` + `findOwnedCourse` | `createMaterialSchema`, discriminated on `kind`: `file` (`title`, `description`, `contentType` ∈ the course-files allowlist, `sizeBytes` ≤ 2 GiB) or `link` (`title`, `description`, `url` — http(s) only via `z.url({protocol:/^https?$/})`, never fetched server-side) | `MaterialActionResult` `{ ok:true, kind:"file", materialId, bucket, path, token }` \| `{ ok:true, kind:"link", materialId }` \| `{ ok:false, error, fieldErrors? }` | File path is `courses/<courseId>/materials/<materialId>/file.<ext>`. Link kind sets `uploadedAt` at creation (no upload step) but `publishedAt` stays null. |
| `retryMaterialUpload(materialId)` | owner | `uuidSchema` | `MaterialActionResult` (file kind only) | Only while the material is `kind:"file"` and `uploadedAt` is null. |
| `finalizeMaterialUpload(materialId, input)` | owner | `finalizeMaterialSchema` (empty — the server re-reads the object's content type itself) | `ActionState` | File kind only. `getCourseFileInfo(path)` must exist with an allowlisted content type; anything else is removed and refused. Records `mimeType`/`uploadedAt`. |
| `publishMaterial(materialId)` / `unpublishMaterial(materialId)` | owner | `uuidSchema` | `ActionState` | Publish requires `uploaded_at` (enforced in the UPDATE's WHERE too) — true for both kinds once ready. |
| `updateMaterial(materialId, prev, fd)` | owner | `materialFormSchema` | `redirect(course page)` | Title/description only, either kind. |
| `reorderMaterials(courseId, input)` | owner of course | `reorderMaterialsSchema` (unique uuids, ≤ 500) | `ActionState` | The list must cover exactly the course's materials; applied in one transaction or not at all. |
| `deleteMaterial(materialId)` | owner | `uuidSchema` | `ActionState` | Removes the Storage object first for file kind (logged if that fails), then the row. Link kind never touches Storage. |

## Server actions (`lib/exams/actions.ts`)

Exams are bilingual (es/en). **Multiple choice and true/false are auto-scored, derived at read time** from the stored selected position vs the current key (`lib/exams/scoring.ts`, `lib/data/exam-results.ts`; nothing score-related is stored, so a key correction re-scores every attempt). Fill in the blank and essay are graded by hand, **points per question** (weight 1–100, default 1; a prompt may hold several blanks, `{{blank}}` token, answers stored per blank). Exams are editable in any state; once attempts exist, edits that would move or drop a stored position are refused (`lib/exams/edit-rules.ts`), and every edit to a published exam re-runs the bilingual publish gate in its transaction. Unpublish is always allowed; delete only while **no attempt exists**. Student responses never include `correct_option` or `reference_answer_*`: `lib/data/exam-attempts.ts` does not select them; right/wrong and scores appear only for submitted attempts (`result`), and the correct position appears only as `revealedAnswers` when the exam's `reveal_keys_after_attempts` is on and all of that student's attempts are used (default off). `lib/exams/exams.integration.test.ts` JSON-scans student payloads mid-attempt and after submit.

| Action | Auth | Rate limit | Schema | On success | Notes |
|---|---|---|---|---|---|
| `createExam(courseId, prev, fd)` | `assertRole("professor","admin")` + `findOwnedCourse` | — | `examFormSchema` (titles/descriptions es+en optional while drafting, `maxAttempts` 1–10, `durationMinutes` 1–480, `revealKeysAfterAttempts` checkbox) | `redirect(/professor/exams/<id>)` | Defaults: 2 attempts, 20 minutes, reveal off. |
| `updateExam(examId, prev, fd)` | owner (ownership joined in the query) | — | `examFormSchema` | `{ success }` | Any state. On a published exam the publish gate re-runs (a failing edit is rolled back and rejected). |
| `deleteExam(examId)` | owner | — | `uuidSchema` | `redirect(course page)` | Refused if any attempt exists (the cascade would destroy student work). |
| `publishExam(examId)` | owner | — | `uuidSchema` | `{ success }` | Bilingual gate re-run inside the transaction that locks the exam row (`lib/exams/publish-rules.ts`): both titles, ≥ 1 question, both prompts per question, multiple choice 2–6 non-empty options with equal counts in both languages and a key in range, true/false key, and the same number of blanks in the es and en prompt of every fill-in-the-blank question. Failure returns the list in `fieldErrors._publish`. |
| `unpublishExam(examId)` | owner | — | `uuidSchema` | `{ success }` | Always allowed, including with attempts (students stop seeing the exam and their results until republished). |
| `createQuestion(examId, prev, fd)` | owner | — | `createQuestionSchema` (type fixed at creation) | `{ success }` | Fields not used by the type are discarded (`normalizeQuestionFields`). Key stored by position and **required** for multiple choice (within the options, ≥ 2 options) and true/false. `points` 1–100 (default 1), ≤ 20 blanks per fill prompt. Any state; blocked once attempts exist (it would be missing from existing attempts). Published exams re-run the publish gate. ≤ 200 questions. |
| `updateQuestion(questionId, prev, fd)` / `deleteQuestion(questionId)` | owner (through the exam's course) | — | `questionFieldsSchema` / `uuidSchema` | `{ success }` | Any state. With attempts: delete is blocked, and an update may not change a multiple-choice option count/order or a fill prompt's blank count (type is immutable). Wording, keys, reference answers and `points` stay editable. Published exams re-run the publish gate. |
| `reorderQuestions(examId, input)` | owner | — | `reorderQuestionsSchema` | `{ success }` | Must cover exactly the exam's questions, one transaction. Blocked once attempts exist. |
| `gradeSubmission(submissionId, prev, fd)` | owner (through the exam's course) | — | `gradeSchema`: `feedback`, one `points:<questionId>` per answered fill/essay question (0..that question's weight, half steps; required for each), one optional `comment:<questionId>` per answer | `{ success }` | Manual grading of fill in the blank and essay only (multiple choice / true-false are scored automatically; points sent for them are ignored). Only a submitted attempt can be graded. Result is **pending** until every answered manual question has points, then **final**. The student's grade of record is the **highest final** attempt percent (derived in queries). The legacy 0–100 `grade` is no longer written (cleared on regrade). |
| `startExamAttempt(examId, courseId, prev, fd)` | `assertUser` + enrollment + published (inside `startAttempt`) | `exam_attempt` / user id (20/h) + IP (300/h) | `startAttemptSchema` (`language` es/en) | `redirect(attempt page)` | Resumes an open attempt (its language is fixed); otherwise creates attempt N+1 up to `maxAttempts`; serialised per student+exam by an advisory lock. The 20-minute (per-exam) clock starts here. |
| `submitExamAttempt(attemptId, input)` | `assertUser`; attempt must be the caller's own | `exam_attempt` | `answersSchema` (`{ answers: [{ questionId, selectedOption? \| answerText? \| blanks? }] }`) + per-type checks vs the real questions | `{ success }` | Every question must be answered (every blank of a multi-blank question). Past deadline + 30 s grace the attempt is closed at its deadline with the autosaved answers and the call returns an error. No cron: expired attempts are closed lazily on the next read/submit. |

## Pages with data access (for completeness; not APIs)

Pages are gated three times: proxy prefix rule → route-group layout (`requireUser`/`requireRole`) → the page itself, plus the query. See CLAUDE.md "Authorization chain".

| Page | Requires | Data function (enforces) |
|---|---|---|
| `/` | — | redirects by role or to `/login` |
| `/dashboard` | any signed-in user | `listEnrolledCourses(userId)` |
| `/courses/[courseId]` | any signed-in user | `getCourseForStudent(courseId, userId)` (enrollment; 404 otherwise; **published** lectures/materials only, with the student's own lecture progress; `hasSyllabus` boolean, never the storage path). The page also calls `listExamsForStudent(courseId, userId, language)` (enrolled + published only). Renders `components/syllabus-viewer.tsx` and `components/course-materials-list.tsx`, which call the two route handlers below. |
| `/courses/[courseId]/lectures/[lectureId]` | any signed-in user | `getLectureForViewer(lectureId, actor)` (enrolled + published, or course owner preview; lecture must belong to `courseId`; 404 otherwise). Renders `components/video-player/lecture-player.tsx`, which calls the two `/api/lectures/*` handlers. |
| `/courses/[courseId]/exams/[examId]` | any signed-in user | `getExamLandingForStudent(examId, userId, language)` (enrolled + published; 404 otherwise; exam must belong to `courseId`) |
| `/courses/[courseId]/exams/[examId]/attempt/[attemptId]` | any signed-in user | `getAttemptForStudent(attemptId, userId)` (own attempt + enrolled; `result` (per-question right/wrong, provisional or final score, pending question numbers) only once submitted; overall feedback only once graded; `revealedAnswers` only under the reveal rule; never keys otherwise). Renders `components/exams/exam-attempt-form.tsx`, which calls the autosave handler and `submitExamAttempt`. |
| `/professor` | professor, admin | `listTaughtCourses(userId)` / admin: `listAllCourses()` |
| `/professor/courses/new` | professor, admin | — (form → `createCourse`) |
| `/professor/courses/[courseId]` | professor, admin | `getCourseForProfessor(courseId, actor)` (ownership; 404 otherwise; all lectures/materials with status + roster + `syllabusUploadedAt`); the page also calls `listExamsForProfessor(courseId)` after that check |
| `/professor/courses/[courseId]/edit` | professor, admin | `getCourseForProfessor` (form → `updateCourse`) |
| `/professor/lectures/[lectureId]/edit` | professor, admin | `getOwnedLecture(lectureId, actor)` (ownership via course join; form → `updateLecture`) |
| `/professor/materials/[materialId]/edit` | professor, admin | `getOwnedMaterial(materialId, actor)` (ownership via course join; form → `updateMaterial`) |
| `/professor/exams/[examId]` | professor, admin | `getOwnedExam(examId, actor)` (ownership via course join; includes keys, professor-only) |
| `/professor/exams/[examId]/submissions` | professor, admin | `getOwnedExam` + `listSubmissionsForExam(examId, actor)` |
| `/professor/exams/[examId]/submissions/[submissionId]` | professor, admin | `getSubmissionForGrading(submissionId, actor)` (ownership via course join; exam id in the URL must match) |
| `/admin` | admin | placeholder |

## Environment variables

| Variable | Used by | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase clients, proxy, CSP | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase clients, proxy | yes |
| `NEXT_PUBLIC_SITE_URL` | `lib/env.ts` for email links | yes in production |
| `DATABASE_URL` | Drizzle at runtime (transaction pooler, 6543) | yes |
| `DIRECT_URL` | drizzle-kit only (session pooler, 5432) | for migrations |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/storage` **only** — signed upload/stream URLs, object checks, deletes on the two private buckets (`lectures`, `course-files`) | yes (lectures, syllabus, course materials) |
| `COLOR_PALETTE` | `lib/palette/server.ts` → root layout (`<html data-palette>`, viewport color) and `GET /icon.svg`. `terracotta` or `blue`; unset or unknown falls back to `blue` (unknown also logs `palette.unknown_value`). Server-only; baked in at build, so changing it needs a redeploy | no |
| `DB_POOL_MAX` | `lib/db/pool-config.ts`: connections held per app instance (1–20; default 5 in production, 1 in dev) | no |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry SDKs (browser + server), CSP `connect-src` | no: unset means Sentry is a no-op |
| `SENTRY_AUTH_TOKEN` | Build only (private source-map upload). Secret, never `NEXT_PUBLIC_` | no: unset skips upload |
| `SENTRY_ORG`, `SENTRY_PROJECT` | Build only (source-map upload target) | no |
| `VIDEO_CDN_URL`, `VIDEO_CDN_HMAC_SECRET` | `lib/video-cdn/server.ts` (stream route) and `next.config.ts` (CSP `media-src`). When both are set, `GET /api/lectures/[id]/stream` returns a Worker URL (same `{ url, expiresAt }` shape) instead of the Supabase URL; unset = rollback. Server-only; secret must match the Worker's | no |

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
| 0007 | `0007_syllabus_and_course_materials.sql` | `courses.syllabus_storage_path`/`syllabus_uploaded_at`; `course_materials` table + `material_kind` enum (`file`/`link`); private `course-files` Storage bucket with size cap + PDF/doc/image/video MIME allowlist |
| 0008 | `0008_icy_goliath.sql` | Bilingual exams: `content_language` enum; es/en columns for exam titles/descriptions, question prompts/options/reference answers; answer key by position (`correct_option`); `max_attempts` (default 2) and `duration_minutes` (default 20); one `exam_submissions` row per attempt (`attempt_number`, `language`, `started_at`, nullable `submitted_at`); answers store `selected_option` or `answer_text` (CHECK exactly one) plus optional per-answer `feedback`; grade 0–100 CHECK. The exam tables were empty and unreferenced, so dropping the old single-language columns was backward-compatible. |
| 0009 | `0009_natural_beast.sql` | Exam scoring (additive, no rows altered): `exam_questions.points` (1–100, default 1), `exam_answers.blank_answers` (jsonb per-blank answers) and `exam_answers.points_awarded` (manual points), `exams.reveal_keys_after_attempts` (default false); "exactly one value" CHECK widened to include `blank_answers`. `exam_submissions.grade` stays as the read-only legacy 0–100 grade. |
