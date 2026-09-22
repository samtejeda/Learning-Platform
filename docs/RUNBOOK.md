# Runbook

What to do when something breaks, and how to recover. Written for one person who may be reading this at a bad moment: each scenario is **symptom → check → fix**.

Conventions: `<site>` is the production URL. Commands marked **(exercised)** were run for real while building this; anything marked **(untested)** has not been, and should be run once in a drill before you rely on it.

## 0. Systems map

| Piece | What it is | Where to look |
|---|---|---|
| App | Next.js on Vercel | Vercel dashboard → Deployments / Logs |
| Database + Auth + Storage | Supabase (Postgres, Auth, Storage) | Supabase dashboard; status.supabase.com |
| SMS codes | Twilio Verify, configured inside Supabase Auth | Supabase → Authentication → Providers → Phone; status.twilio.com |
| Errors | Sentry (free tier) | sentry.io → your project → Issues |
| Uptime | UptimeRobot (free) pinging `<site>/api/health` | uptimerobot.com dashboard |
| Backups | GitHub Actions → encrypted artifact | Repo → Actions → "Nightly encrypted database backup" |

**Owner:** Sam. *Add a second person who can act if you're unreachable, plus their contact, here:* ______

## 1. One-time setup (only you can do these)

Until each item is done, the matching safety net is **not active**. Tick them off.

- [ ] **Sentry.** Create a free org and a Next.js project. In Vercel → Settings → Environment Variables set, for Production (and Preview if you want previews tracked): `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` (mark it *Sensitive*; it is build-time only and uploads source maps). Redeploy.
- [ ] **Sentry privacy settings.** Project Settings → Security & Privacy: turn on **Prevent Storing of IP Addresses**, keep **Data Scrubber** and **Use Default Scrubbers** on. The app already scrubs before sending; this is the second layer.
- [ ] **Sentry alerts** (Alerts → Create Alert → Issues), each notifying your email (and the Sentry mobile app for push): (1) *A new issue is created*; (2) *An issue changes state from resolved to unresolved* (regression); (3) *An issue is seen more than 10 times in 1 hour*. Without these, errors are captured but nobody is told.
- [ ] **UptimeRobot.** New monitor → HTTP(s) → URL `https://<site>/api/health`, interval 5 min, **Keyword monitoring**: alert when keyword `"status":"ok"` does **not** exist (a degraded response contains `"status":"degraded"`). Add your email and the mobile app as alert contacts.
- [ ] **Backups** (see §5): generate the `age` keypair, add the repo variable and secret, run the workflow once by hand.
- [ ] **Supabase.** Confirm which backups your plan includes (Database → Backups). They are a second layer; the encrypted dumps are the layer you control.
- [ ] **Billing alerts** on Vercel, Supabase, Twilio and Sentry (SMS is the one that can spike).
- [ ] Fill in the "second person" line above.

## 2. Where to look

**Logs.** Every server log line is single-line JSON: `{"ts","level","event", ...}`. In Vercel → Logs, search for the `event` name. Retention is short (see your plan), so **Sentry is the history**; use Vercel logs for "what just happened".

| `event` | Level | Meaning |
|---|---|---|
| `auth.sign_in_failed`, `auth.otp_verify_failed` | warn | Wrong credentials/code. A *spike* means someone is guessing. |
| `auth.rate_limited` | warn | A limit tripped (`scope`, `dimension: ip\|identifier`). A spike is an attack; a single one may be a real user. |
| `auth.code_exchange_failed` | warn | An email link (confirm / reset) was expired or reused. |
| `auth.sign_up_failed`, `auth.password_reset_failed`, `auth.update_password_failed` | error | Supabase Auth misbehaving. Also goes to Sentry. |
| `auth.profile_row_missing` | error | An auth user has no `public.users` row. The trigger from `drizzle/0003` is missing or broken: see §4.4. |
| `rate_limit.check_failed_closed` | error | The database is unreachable, so logins are being refused (deliberately). See §3.2. |
| `health.check_failed` | warn | `/api/health` found a dependency down (`check: database\|auth`). |
| `db.not_transaction_pooler` | warn | `DATABASE_URL` isn't on port 6543. Fix the env var. |
| `api.unhandled_error` | error | A route handler threw. Also goes to Sentry. |

**Privacy rule for everything you read or share:** logs and Sentry hold **opaque user ids only**: never emails, phones, IPs or form values. Don't paste dumps or decrypted backups anywhere; they contain student account data.

## 3. Failure scenarios

### 3.1 UptimeRobot says the site is down

1. Open `https://<site>/api/health` yourself.
   - **No response / Vercel error page** → Vercel or DNS problem. Check vercel-status.com and the Vercel dashboard. If a deploy just went out, **roll back** (§4.1).
   - **`503 {"status":"degraded","checks":{"database":"fail",...}}`** → §3.2.
   - **`503 ... "auth":"fail"`** → §3.3.
   - **`200 {"status":"ok"}` but the monitor still alerts** → transient; check the monitor's event log. If it repeats, look for a regional issue.
2. Check Sentry for a burst of new issues, and Vercel Logs for `level:error`.

### 3.2 Database unreachable (`database: "fail"`)

Symptoms: dashboard/login errors, `rate_limit.check_failed_closed` in logs (logins are refused *on purpose* while the DB is down; there is no "fail open").

1. status.supabase.com. If it's an incident, wait; nothing you deploy will help.
2. **Free-plan projects pause after a week of inactivity.** Supabase dashboard → if the project shows *Paused*, click **Restore**. (This has happened once already.) The 5-minute health ping runs `select 1`, which should count as activity and prevent it: confirm by watching the dashboard over a couple of weeks.
3. Check the connection strings in Vercel: `DATABASE_URL` must be the **transaction pooler** (port 6543) with a **percent-encoded** password. A recently rotated password not updated in Vercel looks exactly like an outage.
4. Connection-limit errors under load → see §6.

### 3.3 Supabase Auth down (`auth: "fail"`) or SMS codes not arriving

- Auth: nothing to fix on our side; status.supabase.com. Signed-in users with valid sessions keep working until their token expires.
- SMS: `/api/health` **cannot** see Twilio (it is only reachable through Supabase Auth). Check status.twilio.com and Supabase → Authentication → Logs. Email + password sign-in is the fallback and is independent of Twilio.

### 3.4 A real user is locked out by the rate limiter

Counters live in `rate_limit_buckets`, keyed `scope:kind:subject` (scopes: `login`, `signup`, `otp_send`, `otp_verify`, `reset_request`; kinds: `ip`, `id`; ids are lower-cased). In the Supabase SQL editor:

```sql
-- one person
delete from rate_limit_buckets where key = 'login:id:someone@example.com';
-- everything (safe: these are only counters)
delete from rate_limit_buckets;
```

They expire on their own (windows are 10 minutes to 1 hour).

### 3.5 Someone is attacking sign-in

Signs: a spike of `auth.rate_limited` / `auth.sign_in_failed`. The limiter and Supabase's own limits are already absorbing it. If it persists, tighten `lib/rate-limit/policy.ts` and deploy; if SMS spend is the worry, lower `otp_send`. CAPTCHA (Cloudflare Turnstile) is the deferred next step.

### 3.6 A secret leaked

Rotate in this order, redeploying after Vercel changes: (1) Supabase database password → update `DATABASE_URL`, `DIRECT_URL` in Vercel and `BACKUP_DATABASE_URL` in GitHub; (2) Supabase anon/service keys (Settings → API) → Vercel env; (3) `SENTRY_AUTH_TOKEN`; (4) rotate the `age` key **only** if the *private* key leaked: generate a new pair, update the repo variable, and keep the old private key for decrypting older backups.

### 3.7 The nightly backup failed or stopped appearing

GitHub emails you on a failed run. Common causes: (a) **no run at all** → GitHub pauses scheduled workflows after 60 days without repo activity; open the Actions tab and re-enable, or push a commit; (b) `BACKUP_DATABASE_URL` is the `db.<ref>.supabase.co` host, which is IPv6-only and unreachable from GitHub; use the **session pooler** URL (port 5432); (c) a rotated password; (d) the **restore test failed** but the backup file was still uploaded (by design): investigate before trusting that night's copy. Run "Run workflow" by hand after fixing.

## 4. Recovery procedures

### 4.1 Roll back a bad deploy

Vercel dashboard → Deployments → open the last good deployment → **Instant Rollback** (Pro keeps the full history; Hobby only the previous one). CLI: `vercel rollback`. **(untested until the first real deploy: do it once in a quiet moment.)**

**Rolling back the app does not roll back the database.** So migrations must be **expand-then-contract**:

- Additive migrations first (new nullable column, new table), deploy code that uses them, and only in a *later* release remove what's unused.
- Never drop or rename a column/table in the same release that stops using it.
- A migration must be safe for the *previous* app version to run against. If it isn't, don't rely on rollback for that release; plan to roll forward.

### 4.2 A bad migration or bad data change

1. Stop the bleeding (roll back the app if the code is the trigger, §4.1).
2. Take a fresh dump first so you can't make it worse: run the backup workflow by hand.
3. Prefer a **targeted repair** to a full restore: restore last night's backup into a *scratch* database (the drill in §5.3 does exactly this), read the affected rows out of it, and write them back with SQL. Restoring over the live database is the last resort.

### 4.3 The whole Supabase project is gone (full recovery)

Use the newest backup you trust (§5.2 to decrypt). Then, against a **new** Supabase project:

1. Create the project; note the new URL, anon key, and the **session-pooler** connection string.
2. Recreate what is **not** in any database dump (these are dashboard settings, so write them down *before* you need them): Authentication → URL Configuration (Site URL, Redirect URL `<site>/api/auth/callback`), email confirmations **on**, minimum password length 8, the security notification emails, the Phone provider (Twilio credentials), and the private **`lectures`** Storage bucket.
3. Restore, in this order (`NEW` = the new session-pooler URL; tools must be Postgres-17 clients, or run them through Docker as the scripts do):

   ```bash
   # a. accounts: data only, because a new project already has the auth tables  (untested against a real project)
   pg_restore --data-only --no-owner --no-acl -n auth -t users -t identities -d "$NEW" auth.dump

   # b. the app schemas. The dump contains CREATE SCHEMA public, which already exists: filter it out.   (exercised)
   pg_restore -l app.dump | grep -vE ' SCHEMA - public ' > app.list
   pg_restore --no-owner -L app.list -d "$NEW" app.dump

   # c. REQUIRED, in this order.   (exercised)
   psql "$NEW" -v ON_ERROR_STOP=1 -f drizzle/0003_auth_user_triggers.sql   # recreates the auth.users triggers
   psql "$NEW" -v ON_ERROR_STOP=1 -f drizzle/0002_revoke_postgrest_grants.sql
   ```

   **Steps c are not optional.** In the restore test, skipping `0002` left **210 grants** to `anon`/`authenticated` (Supabase re-grants them on every restored table), and skipping `0003` left **1 of 3** triggers, meaning new sign-ups get no profile row. Both files are idempotent.
4. `pnpm db:migrate` against the new database applies any migrations newer than the backup (the migration journal is restored with the data).
5. Point Vercel at the new project (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL`, `DIRECT_URL`) and redeploy.
6. Verify: `curl <site>/api/health`; sign in as a known user; then run the checks from `scripts/backup/restore-test.sh` by hand (RLS on every table, no `anon` grants, three triggers).

**Lecture videos are not in the backup.** Storage objects live outside the database. Recovery means re-uploading from the professors' originals. Deciding whether to back these up is an open item.

### 4.4 `auth.profile_row_missing` or new users get no profile

The `auth.users` triggers are gone (usually after a restore). Re-apply `drizzle/0003_auth_user_triggers.sql`. It is idempotent and back-fills any missing profile rows.

## 5. Backups

### 5.1 What you have

Nightly (07:17 UTC) and on demand: one file `backup-<timestamp>.tar.age` per run, kept 30 days as a workflow artifact (Actions → the run → Artifacts). It is encrypted to your **public** key; only the private key you keep offline can open it. Inside: `app.dump` (schemas `public` + `drizzle`), `auth.dump` (`auth.users` + `auth.identities`), and a counts-only `manifest.txt`. Every run also restore-tests the dump into a throwaway Postgres and fails loudly if anything is off.

### 5.2 Decrypt one **(exercised)**

```bash
age -d -i key.txt backup-20260921T071700Z.tar.age | tar -xf -   # gives app.dump, auth.dump, manifest.txt
```

Do this in an empty temp directory and delete it afterwards. The files are plaintext student account data.

### 5.3 Quarterly restore drill (about 15 minutes)

The automated test proves each dump restores into a *Supabase-flavoured local* Postgres. Only you can prove the two things it can't: that **your private key really opens the artifact**, and that a dump loads into a **real fresh Supabase project**.

1. Download the latest artifact; decrypt it with the offline key (§5.2).
2. `scripts/backup/restore-test.sh <dir-with-the-3-files>`: needs Docker. **(exercised)** Expect `restore test passed`.
3. **Once, then after any big change:** create a free throwaway Supabase project and run §4.3 steps 3a-3c against it, then delete the project. This is the only step in §4.3 marked *untested*.
4. Delete the decrypted files.

### 5.4 Setting up the key and secrets (first time)

```bash
age-keygen -o key.txt        # prints "Public key: age1..."; store key.txt OFFLINE (password manager + a second copy)
```

- Repo **variable** `BACKUP_AGE_PUBLIC_KEY` = the `age1...` line. It is public and safe as a variable.
- Repo **secret** `BACKUP_DATABASE_URL` = the **session-pooler** URL (port 5432), *not* `db.<ref>.supabase.co`.
- Never commit `key.txt`. Losing it makes every backup unreadable; keep two copies.
- Optional hardening (untested): a dedicated read-only database role for `BACKUP_DATABASE_URL` so a leaked secret can't write. Note that RLS is on with no policies, so such a role would need `BYPASSRLS`, which Supabase may not let you grant. Verify before relying on it.

## 6. Scaling notes

What Vercel does for you: it runs the app on many instances behind its own load balancer, scales them automatically, and routes around unhealthy ones. Sessions are stateless (Supabase JWT cookies), so any instance can serve any request. There is nothing to configure and nothing to run.

What is ours:

- **Connection pool.** Each instance keeps `DB_POOL_MAX` connections (default 5) to the Supabase **transaction pooler**. *Instances × pool size* is what reaches the pooler, so raising the pool raises the risk. If you see connection errors under load, first check Supabase's pooler client limit and compute size; upgrading Supabase compute is usually the right fix, not a bigger pool.
- **Read replicas: not set up, deliberately.** At academy scale a single database is fine. Revisit when database CPU is sustained above ~70%, or when read latency on course/lecture pages grows. Then add a Supabase read replica and route the read-only `lib/data/*` queries to it.
- **Caching.** Per-user, permission-scoped queries are deliberately **not** cached across requests (a cache could show a student a course after they were unenrolled). Revisit only with real traffic numbers, and only for non-permissioned data.
- **Video** is served by Supabase Storage via short-lived signed URLs, not through Vercel compute.
- **Known blind spot:** `/api/health` checks Postgres and Supabase Auth only. It cannot see Twilio, Storage or Sentry.
