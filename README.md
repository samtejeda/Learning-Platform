# Learning Platform

A mobile-first web learning platform in the style of Blackboard. Students watch video lectures, take exams, and read course materials. Professors build courses, invite students, and grade work. Administrators manage the platform.

It is built to be **deployed by each organization on its own accounts**: your own Supabase project, your own hosting account, your own domain. There is no shared, multi-tenant service and no operator in the middle. Naming, schema, and routes are institution-neutral (`courses`, `lectures`, `professor`), so the same codebase suits a school, a training company, or a church academy (the first real deployment is a church academy).

**Stack:** Next.js 16 (App Router) + TypeScript, Supabase (Postgres, Auth, Storage), Drizzle ORM, Vercel, with optional Sentry, a Cloudflare Worker for video caching, and Twilio phone sign-in.

> **"Learning Platform" is a working title, and the code is all rights reserved for now.** See [License](#license).

---

## Contents

1. [What works today, and what does not](#1-what-works-today-and-what-does-not)
2. [External services you need accounts for](#2-external-services-you-need-accounts-for)
3. [Setup, step by step](#3-setup-step-by-step)
4. [Environment variable reference](#4-environment-variable-reference)
5. [Day-to-day commands](#5-day-to-day-commands)
6. [Troubleshooting first install](#6-troubleshooting-first-install)
7. [Before you open it to real users](#7-before-you-open-it-to-real-users)
8. [Further documentation](#8-further-documentation)
9. [Verification status of this guide](#9-verification-status-of-this-guide)
10. [License](#license)

---

## 1. What works today, and what does not

Read this before you commit to a deployment. Anything in the "not built" list is **not available**: it has no screen, route, or setting, whatever the name might suggest.

**Built and working** (code is merged and covered by automated tests; see [section 9](#9-verification-status-of-this-guide) for what this guide itself checked):

- Accounts: email + password sign-up and sign-in, password reset by email link, three roles (student, professor, admin), all permission checks on the server.
- Phone-number sign-in by SMS code **for accounts that already have a phone number on file** (see the caveat in the Twilio row below).
- Courses, and enrollment **by professor invitation** (by email). There are no join codes and no open self-enrollment. Anyone can create an account; being enrolled is what gives access to a course.
- Lectures: a professor either uploads a video file straight to private storage or (per lecture) embeds a YouTube video, see the services table; uploaded files are streamed by students through short-lived signed URLs in a custom player with no native controls. A lecture counts as complete only when the server has seen at least 95% genuinely watched.
- Syllabus (one PDF per course), course materials (uploaded files or external links, with a draft/publish step).
- Exams: multiple choice, true/false (both auto-scored), fill in the blank and short essay (graded by hand), per-exam attempts and time limits, English and Spanish wording on every exam.
- Operations: encrypted nightly database backups with an automated restore test, error tracking, a health endpoint, rate limiting on sign-in, a CI pipeline, and a runbook.

**NOT BUILT YET** (do not plan a launch around these):

| Feature | State |
|---|---|
| **Admin tools** | The `/admin` page is a placeholder that says so. Roles are changed with a SQL statement (see [step 3.6](#36-create-the-first-admin-by-sql)). |
| **Assignments** | Database tables exist; there are no routes or screens. |
| **Forum** | Database tables exist; there are no routes or screens. |
| **Stripe course purchases** | Not built. Courses can only be reached by invitation. |
| **YouTube-embedded lectures** | Backend built; the screens are not. A lecture can be an uploaded file or an embedded YouTube video, chosen per lecture, but there is no form to add a YouTube lecture and the student player cannot play one yet. See the YouTube row in the services table below. |
| **Lecture comprehension question** | Built, except two screens. A professor can write a bilingual multiple-choice question per lecture and switch it on or off, and students answer it after finishing the lecture (two attempts). Passing, or being unlocked by the professor, opens the next lecture; a student who fails twice stays locked until the professor unlocks them. The server enforces all of this. **Not built yet:** the designed "locked" screens for students, the professor's list of blocked students, and the Unlock button (the backend for them exists). There is no notification: a blocked student contacts the teacher outside the app. |
| **Attaching a phone number to an account in the app** | Not built, so phone sign-in only works for accounts whose phone was set some other way. |
| **Student language setting** | Not built. Exam content is bilingual; the interface text is English. |
| **Deleting a course from the UI** | Not built. Deleting a course directly in the database leaves its stored files behind. |

---

## 2. External services you need accounts for

Each organization creates these on its **own** accounts. Free-tier figures come from the project's own notes as of November 2026. Vendors change plans, so check each pricing page before you rely on a number.

| Service | What it is for | Required? | Free-tier limits that matter | What breaks without it |
|---|---|---|---|---|
| **Supabase** | Postgres database, Auth (sign-in, email links, SMS), and private file Storage for videos, PDFs and uploads. | **REQUIRED** | **50 MB maximum size per uploaded file on the free plan**, which blocks real lecture videos (a 45-minute lecture at the recommended encode is roughly 500 MB). Real lectures need the paid Pro plan. Free projects **pause after about a week of inactivity** and must be restored by hand. No spend cap is configurable without a payment method. Pro includes 100 GB storage and 250 GB monthly egress; egress past that is billed. | Nothing works: no database, no sign-in, no files. |
| **Hosting: Vercel** (the only documented path) | Runs the Next.js app, builds every pull request into a preview URL, applies database migrations on production deploys. | **REQUIRED** (a host is; Vercel is the supported one) | **Vercel's free (Hobby) plan is for non-commercial use only.** An organization running a real school, or charging anyone, should plan for a paid plan; read Vercel's current terms for your case. Hobby keeps only one previous deployment for rollback and does not support spend budgets. | No site. Other hosts are not documented or tested here: the code does not depend on Vercel at runtime, but the migrate-on-deploy script (`scripts/vercel-build.sh`) is Vercel-specific, and you would run `pnpm db:migrate` yourself. |
| **GitHub** | Holds the code, runs CI on every pull request (lint, types, tests, migration check, build), and runs the nightly encrypted database backup. | **REQUIRED** for CI and backups as shipped. | Actions minutes are limited on private repositories (public repositories are free). The backup is one short job a night. GitHub **pauses scheduled workflows after 60 days with no repository activity**. Branch protection on private repositories may need a paid plan. | No CI, no automatic backups. The app itself still runs, but you lose both safety nets. |
| **A domain name** | A real address for the site, and the prerequisite for sending email. | **OPTIONAL** to run; **needed for real sign-ups** (via the SMTP row). | Roughly a yearly fee, no free tier. | The site works on a `*.vercel.app` address, but you cannot send real confirmation and reset emails (below), and addresses are not memorable. |
| **SMTP provider, e.g. Resend** | Sends the sign-up confirmation and password-reset emails, configured inside Supabase Auth. | **REQUIRED before real users** | Providers have free tiers. **Every serious provider requires a verified domain** (DNS records) before it will send to anyone except the account owner, so this needs the domain above. | Supabase's built-in mailer is for development only and is rate-limited **across the whole project**: a few sign-ups an hour exhaust it, and further sign-ups and password resets fail. |
| **Twilio (through Supabase Auth)** | Sends SMS codes for phone-number sign-in. | **OPTIONAL** | Paid per message or verification; trial accounts can only text verified numbers. SMS is the one cost that can spike, so set a billing alert. | Phone sign-in does not work. Email + password sign-in is independent and still works. Note that phone sign-in only works for accounts that already have a phone number, and attaching one in the app is [not built](#1-what-works-today-and-what-does-not). |
| **Cloudflare (a Worker)** | Caches lecture video in front of the signed URLs so repeat viewings do not pay Supabase egress again (the app authorizes each request first). | **OPTIONAL**, but recommended before real traffic. | Workers free plan: 100,000 requests per day and 10 ms CPU per request. A 45-minute lecture is about 75 requests, so roughly 1,300 full views a day. Cache is per Cloudflare data center, not global. | Video still plays, straight from Supabase. Cost is the only effect: every view downloads the whole file from Supabase and counts against egress. Turning the Worker off later is just unsetting `VIDEO_CDN_URL`. |
| **Sentry** | Error tracking (`@sentry/nextjs`). Configured to send no personal data and no session replay. | **OPTIONAL** | Free Developer plan. New organizations start with a short trial of paid features, then drop to free automatically; note the trial end date so a "plan ending" email is not a surprise. | Nothing visible to users. With no DSN every Sentry call is a no-op; you only lose error history and alerts. |
| **UptimeRobot** (or any uptime monitor) | Pings `/api/health` every few minutes and emails you when the site or database is down. | **OPTIONAL** | Free plan with 5-minute checks (what the runbook assumes). Check the current limits. | Nobody is told when the site is down. |
| **Stripe** | Would take payment for courses. | **NOT BUILT YET** | n/a | There is no payment feature. Do not create a Stripe account for this project yet. |
| **YouTube** (embedded lectures) | Lets a lecture be an embedded YouTube video instead of an uploaded file. Chosen per lecture, so a course can mix both. Students' browsers load Google's player (the privacy-enhanced `youtube-nocookie.com` host) and Google's player script. | **OPTIONAL**, per lecture. No account, key or setting is needed, and nothing is configured on the server. | Free. Subject to YouTube's terms: the player cannot be covered or modified, and ads or related videos may appear in it. | Uploaded lectures are unaffected. If you never create a YouTube lecture, nothing is loaded from Google. **Limits to know before using it:** an unlisted YouTube video can be watched by anyone who has its link, so do not use it for content that must stay paid-only or enrolled-only. Watch-tracking is weaker than for uploaded lectures (the player cannot be locked, and a viewer can change speed), so completion is less trustworthy. Your privacy policy must mention YouTube, and if your students are children you must also tell YouTube the content is made for kids. The backend is built; the professor form and student player are not yet. |

Cost-control notes that apply across services: set billing alerts on Vercel, Supabase, Twilio and Sentry once on a paid plan, and prefer alert-only budgets over auto-pause, since auto-pause on a live student site becomes an outage.

---

## 3. Setup, step by step

Work through these in order. Steps marked **(optional)** can be skipped for a first local install.

### 3.0 What you need installed

- **Node.js 24.x** (`.nvmrc` pins `24`; `package.json` requires `24.x`).
- **pnpm 11** (`package.json` pins `pnpm@11.0.8`; the CI action reads that field). Install via Corepack or your package manager.
- **git**.
- Only for the optional steps: **age** (backups), **Docker** (to run the backup restore test), **ffmpeg** or HandBrake (to encode lectures, see [docs/ENCODING.md](docs/ENCODING.md)).

### 3.1 Clone and install

```bash
git clone <your-repository-url> learning-platform
cd learning-platform
pnpm install --frozen-lockfile
```

This is the exact command CI and Vercel use.

### 3.2 Create the Supabase project

1. Create a project. **Recommended: two projects**, one for production and one shared by local development and Vercel preview deployments, so a pull request can never touch real data.
2. Collect from the dashboard (the labels move around, so search for these values rather than trusting a menu path):
   - the **project URL**, the **anon (public) key**, and the **service_role key** (project API settings);
   - two database connection strings from the **Connect** panel: the **Transaction pooler** (port **6543**), used at runtime, and the **Session pooler** (port **5432**), used for migrations and backups.
3. Do **not** use the direct `db.<ref>.supabase.co` host: it is IPv6-only, so GitHub Actions cannot reach it (the backup job fails), and other networks may not either. Use the pooler strings.
4. If the database password contains `@`, `#`, `/` or `%`, percent-encode it inside the URL (`@` becomes `%40`) or the connection fails.

The migrations create the app's tables **and** the two private storage buckets (`lectures`, `course-files`) and reference Supabase's `auth` and `storage` schemas. They need a real Supabase database; plain Postgres will not work.

### 3.3 Configure environment variables locally

```bash
cp .env.local.example .env.local
```

Fill in `.env.local` (it is git-ignored; never commit it). **Also add `SUPABASE_SERVICE_ROLE_KEY=<your service_role key>`.** The app refuses to handle any file upload or download without it, and `.env.local.example` does not currently list it. Every variable is described in [section 4](#4-environment-variable-reference).

Minimum for a working local install: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` (`http://localhost:3000`), `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (transaction pooler), `DIRECT_URL` (session pooler).

### 3.4 Apply the database migrations

```bash
pnpm db:migrate
```

This applies every file in `drizzle/` in order (the app tables, row-level security, the database triggers that create a profile row for each new account, the rate-limit table, and the storage buckets). It is idempotent: running it again does nothing. Migrations are forward-only, and there is deliberately no `db:push`.

To check that the migration files are internally consistent without touching any database, run `pnpm db:check` (it needs `DIRECT_URL` set to any URL; nothing connects).

### 3.5 Configure Supabase Auth

In the Supabase dashboard, under Authentication:

- **Site URL** = the exact value of `NEXT_PUBLIC_SITE_URL` for that project.
- **Redirect URLs** must include `<site>/api/auth/callback`. For the shared dev/preview project, add a wildcard entry covering your Vercel preview hostnames.
- **Confirm email: on.**
- **Minimum password length: 8.**
- **Notify the user when their password changes: on.**
- Leave Auth rate limits at their defaults.
- **Email delivery:** the default mailer is dev-only (see the SMTP row above). For a first look you can create users in the dashboard instead (Authentication, Users, add user, auto-confirm), which also creates the profile row through the trigger. For real users, set up custom SMTP here once you have a domain.
- **Phone sign-in (optional):** enable the Phone provider and enter your Twilio Verify credentials.

### 3.6 Create the first admin by SQL

There is no in-app admin tooling yet, so the first admin (and every professor) is promoted with SQL. New accounts are always created as `student`.

1. Register an account in the app (`/register`), or create one in the Supabase dashboard, and make sure it is confirmed.
2. In the Supabase **SQL editor**, run:

```sql
-- role is one of: student, professor, admin
update public.users set role = 'admin' where email = 'you@your-organization.example';
```

3. Sign out and back in. A trigger copies the role into the sign-in token, and a stale token can still hold the old role for up to an hour. Real permission checks read the database on every request and are not affected by that delay.

An admin can open all the professor screens. Promote professors the same way with `role = 'professor'`.

### 3.7 Run the app and the tests

```bash
pnpm dev                 # http://localhost:3000
```

Checks that need no database (the same ones CI runs):

```bash
pnpm lint
pnpm typecheck
pnpm test                # unit tests
```

A production build, using placeholder values as CI does (nothing connects at build time):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder \
NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
DATABASE_URL=postgresql://user:pass@localhost:5432/db \
pnpm build
```

Tests that **do** need a real database and Storage (use a throwaway development project only, **never production**):

```bash
pnpm test:integration    # seeds @example.test accounts and courses, then deletes its own data
pnpm build && pnpm start -p 3111   # in one terminal...
pnpm test:http                     # ...and this in another (about a minute; it waits real seconds)
```

`pnpm test:integration` deletes every course owned by its seed professors, so do not run it against a project where you keep demo courses under those accounts.

### 3.8 Push to your own GitHub repository (CI)

Push to a repository you own. `.github/workflows/ci.yml` then runs on every pull request and every push to `main`: lint, typecheck, unit tests, migration consistency, and a build with placeholder values. It needs no secrets.

Recommended repository settings (you set these in GitHub; they are not in the code):

- Protect `main`: require a pull request and require the **`checks`** job to pass.
- Work on branches and merge through pull requests; do not commit to `main` directly.

### 3.9 Deploy on Vercel

1. In Vercel, import the GitHub repository. `vercel.json` already sets the framework, `pnpm install --frozen-lockfile`, the build command (`pnpm build:vercel`), and the region (`iad1`; change it to sit near your Supabase region).
2. Set environment variables per scope (Project, Settings, Environment Variables):

| Scope | Set these |
|---|---|
| **Production** | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` (the real `https://` origin; production refuses to run without it), `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, **`DIRECT_URL`**. Plus any optional ones you use. |
| **Preview** | The same, **except never `DIRECT_URL`**, ideally pointing at the separate development Supabase project. Previews must not be able to migrate production. |

3. Deploy. On a **production** deploy, `scripts/vercel-build.sh` first runs `drizzle-kit migrate` (and fails the deploy if a migration fails, so the previous version stays live), then builds. Preview deploys skip migrations.
4. Set the Supabase **Site URL** and redirect URL to the final address, then confirm `https://<your-site>/api/health` returns `{"status":"ok"}`.
5. Changing a `NEXT_PUBLIC_*` variable (or `COLOR_PALETTE`) needs a **redeploy**, because they are baked in at build time.

**Rolling back:** Vercel, Deployments, pick a good deployment, Instant Rollback. A rollback reverts code, not the database, so write migrations that the previous version can still run against (add first, remove in a later release). After a rollback, auto-assignment of the production domain is switched off and must be re-enabled by hand, or nothing you merge afterwards goes live; see [docs/RUNBOOK.md](docs/RUNBOOK.md) section 4.1.

### 3.10 Encrypted nightly backups (optional, recommended)

The workflow `.github/workflows/backup.yml` dumps the database, encrypts it with a **public** key so only your offline **private** key can open it, restore-tests it in a throwaway Postgres, and keeps the encrypted file as a workflow artifact for 30 days.

```bash
age-keygen -o key.txt     # prints "Public key: age1..."
```

1. Store `key.txt` **offline** (a password manager plus a second copy) and never commit it. **If you lose it, every backup becomes unreadable.**
2. In GitHub (Settings, Secrets and variables, Actions):
   - **variable** `BACKUP_AGE_PUBLIC_KEY` = the `age1...` line;
   - **secret** `BACKUP_DATABASE_URL` = the Supabase **session pooler** string (port 5432), not the direct host.
3. In the Actions tab, run "Nightly encrypted database backup" once by hand and confirm it passes.
4. Scheduled workflows only run from the default branch. If backups stop appearing, check whether GitHub paused the schedule after 60 days of inactivity.

Decrypt, the quarterly restore drill, and full-project recovery are in [docs/RUNBOOK.md](docs/RUNBOOK.md) sections 4 and 5. **Uploaded files (lecture videos, PDFs) are not in this backup**, only the database. Keep the professors' original files.

### 3.11 Lecture video CDN Worker (optional)

Skip this until you have real lectures. Without it video still works.

1. Create a Cloudflare account and an **API token** that can edit Workers; note your **account ID**.
2. Generate one shared secret. It must be the **same value** in Vercel and in the Worker:

   ```bash
   openssl rand -hex 32
   ```

3. Deploy the Worker (the exact commands are in [docs/RUNBOOK.md](docs/RUNBOOK.md) section 8):

   ```bash
   cd workers/video-cdn
   export CLOUDFLARE_API_TOKEN=<your token> CLOUDFLARE_ACCOUNT_ID=<your account id> WRANGLER_SEND_METRICS=false
   npx wrangler deploy --var SUPABASE_ORIGIN:https://<your-project>.supabase.co
   printf '%s' '<the shared secret>' | npx wrangler secret put VIDEO_CDN_HMAC_SECRET
   ```

   The Worker is named `lp-video-cdn` and is served from `https://lp-video-cdn.<your-workers-subdomain>.workers.dev`. A brand-new `workers.dev` hostname can refuse connections for a minute or two after its first deploy.
4. In Vercel **Production**, set `VIDEO_CDN_URL` (that origin) and `VIDEO_CDN_HMAC_SECRET` (the shared secret), and redeploy. Both must be set; with either missing, the app uses plain Supabase URLs.
5. Verify. This needs one uploaded lecture and `SUPABASE_SERVICE_ROLE_KEY`, `VIDEO_CDN_URL` and `VIDEO_CDN_HMAC_SECRET` in `.env.local` (the object path looks like `courses/<courseId>/lectures/<lectureId>/video.mp4`):

   ```bash
   pnpm cdn:verify -- <object path>
   ```

   "different token hits cache" must read `true`.

Roll back by removing `VIDEO_CDN_URL` and redeploying. Details, rotation, and limits: [docs/RUNBOOK.md](docs/RUNBOOK.md) section 8.

### 3.12 Monitoring (optional)

Create a Sentry project and an uptime monitor on `/api/health`, then set the four Sentry variables in Vercel. Alert rules, privacy settings, and the exact monitor settings are the checklist in [docs/RUNBOOK.md](docs/RUNBOOK.md) section 1.

### 3.13 Lecture encoding

Uploads must be MP4, H.264, at most 720p, about 2 Mbps, with the index at the front of the file. The server checks every upload and removes a file that fails, naming the problem. Give professors the ffmpeg or HandBrake settings in [docs/ENCODING.md](docs/ENCODING.md) before they upload anything.

---

## 4. Environment variable reference

Taken from `.env.local.example`, checked against the variables the code reads. Server-only variables must never get a `NEXT_PUBLIC_` prefix.

### The app (`.env.local` locally; Vercel environment variables when deployed)

| Variable | Required? | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Required** | Your Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Required** | The Supabase anon (public) key. The database blocks it from reading data; it exists for sign-in and signed-URL uploads. |
| `NEXT_PUBLIC_SITE_URL` | **Required in production**; defaults elsewhere | The site's real origin, used to build links in auth emails. Locally `http://localhost:3000`. Production refuses to run without it so email links never point at a preview or localhost. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Required**, server-only. **Missing from `.env.local.example`; add it yourself.** | Used only by the storage code to sign upload and download URLs, check that an uploaded file exists, and delete files. Never used for database queries. |
| `DATABASE_URL` | **Required** | Runtime database connection: the Supabase **Transaction pooler**, port 6543. |
| `DIRECT_URL` | **Required for migrations** (local `.env.local`; Vercel **Production only**) | Migration connection: the Supabase **Session pooler**, port 5432. Never set it in Vercel Preview scope. |
| `DB_POOL_MAX` | Optional (1 to 20; default 5 in production, 1 in dev) | Database connections each app instance holds. Raise with care; see [docs/RUNBOOK.md](docs/RUNBOOK.md) section 6. |
| `COLOR_PALETTE` | Optional (`blue` or `terracotta`; unset means `blue`) | Site color palette. Baked in at build time. See [design/PALETTES.md](design/PALETTES.md). |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional | Sentry project DSN. Empty means Sentry is off. |
| `SENTRY_AUTH_TOKEN` | Optional, secret, build-time only | Uploads source maps privately. |
| `SENTRY_ORG` | Optional | Sentry organization slug. |
| `SENTRY_PROJECT` | Optional | Sentry project slug. |
| `VIDEO_CDN_URL` | Optional (needs the next row) | Origin of your deployed video Worker. Unset means plain Supabase video URLs (also the rollback). |
| `VIDEO_CDN_HMAC_SECRET` | Optional (needs the row above), secret | Shared secret between the app and the Worker. |

### Other places configuration lives

| Where | Name | Required? | Purpose |
|---|---|---|---|
| Cloudflare Worker (variable) | `SUPABASE_ORIGIN` | Required **if** you deploy the Worker | `https://<your-project>.supabase.co`, passed to `wrangler deploy --var`. |
| Cloudflare Worker (secret) | `VIDEO_CDN_HMAC_SECRET` | Required **if** you deploy the Worker | Same value as in Vercel; set with `wrangler secret put`. |
| Your shell, when deploying the Worker | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Required **if** you deploy the Worker | Never commit them. |
| GitHub repository **secret** | `BACKUP_DATABASE_URL` | Required **if** you use the backup workflow | Session-pooler URL (port 5432). |
| GitHub repository **variable** | `BACKUP_AGE_PUBLIC_KEY` | Required **if** you use the backup workflow | The public `age1...` key (safe to store as a variable). |

Developer-only scripts (`pnpm screenshots`, `pnpm flow-*`, and similar) read a few more variables such as `E2E_BASE_URL` and `STUDENT_EMAIL`; you do not need them to run or deploy the app.

---

## 5. Day-to-day commands

```bash
pnpm dev            # dev server
pnpm build          # production build
pnpm start          # serve the production build
pnpm lint           # eslint
pnpm typecheck      # tsc --noEmit
pnpm test           # unit tests
pnpm db:generate    # after editing lib/db/schema.ts: write a new migration
pnpm db:migrate     # apply pending migrations
pnpm db:check       # verify migrations and snapshots are consistent
pnpm db:studio      # Drizzle Studio
```

Schema change workflow: edit `lib/db/schema.ts`, run `pnpm db:generate`, review the SQL, commit it (including `drizzle/meta/`), then `pnpm db:migrate`. For SQL Drizzle cannot model (grants, triggers, functions) use `pnpm drizzle-kit generate --custom --name=<slug>` and write the SQL by hand.

---

## 6. Troubleshooting first install

| Symptom | Likely cause |
|---|---|
| `DIRECT_URL or DATABASE_URL must be set for drizzle-kit` | No `.env.local`, or it is empty. The `pnpm db:*` scripts read `.env.local`. |
| `SUPABASE_SERVICE_ROLE_KEY must be set` when opening a file | The variable is missing. It is not in `.env.local.example`; add it. |
| Database connection fails with a password that looks right | Special characters in the password are not percent-encoded, or you used the direct `db.<ref>` host instead of a pooler string. |
| Sign-up fails with "too many attempts" after a couple of tries | Supabase's built-in email sender is project-wide rate-limited. Set up custom SMTP, or create the user from the dashboard. |
| Everything was fine, now every page errors | A free Supabase project paused after a week of inactivity. Restore it in the dashboard. |
| Email links go to the wrong place, or the confirmation link fails | `NEXT_PUBLIC_SITE_URL`, the Supabase Site URL and the redirect URL do not all match. A link opened in a different browser than the one used to sign up can show a generic "invalid link" even though the account was confirmed; signing in then works. |
| A lecture upload is rejected | It failed the encode check; the message says why. See [docs/ENCODING.md](docs/ENCODING.md). |
| Lecture upload fails at about 50 MB | The free Supabase plan's per-file cap. Use the Pro plan for real lectures. |

---

## 7. Before you open it to real users

- Move Supabase to a paid plan if you will upload real lectures (the free plan's 50 MB per-file cap), and Vercel to a paid plan if the Hobby plan's non-commercial limit applies to you.
- Get a domain, verify it with an SMTP provider, and configure that provider in Supabase Auth.
- Set billing alerts on every paid service.
- Consider the video CDN Worker before real viewing traffic.
- Students may include minors. The platform collects little and shows student data conservatively, but **you** run the deployment and hold the data. This repository does **not** include a terms of service, privacy policy, cookie notice, or parental-consent wording; you are responsible for having them reviewed for your jurisdiction.
- The security headers include a Content-Security-Policy that is currently **report-only**, not enforced.
- Decide whether to back up your Storage files (the nightly backup covers the database only).

---

## 8. Further documentation

- [docs/RUNBOOK.md](docs/RUNBOOK.md): failure scenarios, rollback, backup and restore drills, scaling notes, the video Worker.
- [docs/ENCODING.md](docs/ENCODING.md): how to encode lecture videos so uploads are accepted.
- [API.md](API.md): inventory of every route handler and server action, and the conventions they follow.
- [design/PALETTES.md](design/PALETTES.md): the color palette system.

---

## 9. Verification status of this guide

Checked on 2026-11-09 from a fresh checkout, with no real accounts, secrets or network services involved.

**Run and passed:**

- `pnpm install --frozen-lockfile`
- `pnpm lint` (no errors; 62 warnings, 57 of them `no-console`)
- `pnpm typecheck`
- `pnpm test` (281 tests passing)
- `pnpm db:check` with `DIRECT_URL` set to a placeholder URL (passes); without `.env.local` the `pnpm db:*` scripts fail with the message shown in [section 6](#6-troubleshooting-first-install)
- `pnpm build` with the placeholder values from [step 3.7](#37-run-the-app-and-the-tests)
- A Worker bundle check using `wrangler deploy --dry-run` (compiles; nothing uploaded)
- `age-keygen`, then an encrypt and decrypt round trip with that key

**Could not verify (needs a real account or database):**

- `pnpm db:migrate` and everything after it that touches a database: the first-admin SQL (written from the schema and the role-sync trigger, not executed), `pnpm test:integration`, `pnpm test:http`.
- `pnpm dev` itself (its boot was not checked on this machine; `pnpm build` was).
- The Supabase dashboard steps and labels, the Vercel import and environment-scope setup, GitHub repository settings, and the backup workflow running on a repository that is not the original one. The backup scripts need Docker and a database, so the restore test was not run for this guide.
- The Cloudflare Worker deploy and `wrangler secret put` as written above. The original team ran those commands for real on 2026-10-02 (recorded in the runbook); this guide only dry-ran the bundle.
- Twilio and the SMTP provider setup.
- Every free-tier limit and price: copied from the project's notes and may be out of date.

---

## License

**Copyright (c) 2026 Sam Tejeda. All rights reserved.** See [LICENSE](LICENSE).

The source is public so it can be read, but it is **not** open source today: no permission is granted to use, copy, modify, deploy or redistribute it without the copyright holder's written permission. To ask for a license, see the contact line in [LICENSE](LICENSE).

The maintainer intends to choose a license (open source or per-organization commercial) before any outside organization deploys it. Until that is announced here, assume the terms above.
