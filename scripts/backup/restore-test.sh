#!/usr/bin/env bash
# Prove a backup is restorable, not merely present.
#
# Loads DIR/{app.dump,auth.dump} into a throwaway Supabase-flavoured Postgres,
# replays the documented recovery sequence, then asserts against DIR/manifest.txt.
# Everything printed is table names and counts: never row data, because CI
# logs are readable by anyone with repo access.
#
# Recovery sequence exercised (also in docs/RUNBOOK.md):
#   1. auth.users + auth.identities   (recreated here from the captured
#                                      definition; a fresh Supabase project
#                                      already has them, so use --data-only)
#   2. app.dump                       (public + drizzle: tables, data, RLS)
#   3. drizzle/0003 (auth triggers)   (idempotent; recreates the triggers that
#                                      live on auth.users, which no dump of
#                                      ours contains, and re-syncs role claims)
#   4. drizzle/0002 (revoke grants)   (idempotent; pg_dump records only the
#                                      final ACL, and Supabase's default
#                                      privileges re-grant anon/authenticated
#                                      on every new table at restore time)
#
# Usage: scripts/backup/restore-test.sh DIR
# Needs Docker and network (pulls the pinned supabase/postgres image).

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DIR="${1:-}"
[ -n "$DIR" ] || die "usage: restore-test.sh DIR"
DIR="$(cd "$DIR" && pwd)"
for f in app.dump auth.dump manifest.txt; do
  [ -s "$DIR/$f" ] || die "$DIR/$f is missing or empty"
done
require_docker

PG_MAJOR="$(sed -n 's/^pg_major=//p' "$DIR/manifest.txt")"
[ -n "$PG_MAJOR" ] || die "manifest.txt has no pg_major"
IMAGE="$(supabase_image_for_major "$PG_MAJOR")"

NAME="backup-restore-test-$$"
PW="restore-test-only"
LOG="$(mktemp)"
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -f "$LOG"
}
trap cleanup EXIT

ex() { docker exec -i -e PGPASSWORD="$PW" "$NAME" "$@"; }
# Superuser psql inside the container: SQL on stdin or via extra args.
rpsql() { ex psql -U supabase_admin -h 127.0.0.1 -d postgres -At -v ON_ERROR_STOP=1 "$@"; }

# pg_restore prints failing statements and row context on errors, which can
# contain row values. Show only the one-line "error:" summaries.
sanitized_errors() {
  grep -E '^pg_restore: error:' "$LOG" | cut -c1-240 | head -15 || true
}

log "starting throwaway $IMAGE"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD="$PW" \
  -v "$DIR:/backup:ro" -v "$REPO_ROOT/drizzle:/migrations:ro" \
  "$IMAGE" >/dev/null

# TCP readiness (not just the unix socket): the image's init phase runs a
# temporary server that does not listen on TCP, so this only succeeds once the
# real server is up.
tries=0
until rpsql -c "select 1" >/dev/null 2>&1; do
  tries=$((tries + 1))
  [ "$tries" -le 60 ] || die "restore target did not become ready in 120s"
  sleep 2
done

FAILURES=0
fail() { printf '[backup] FAIL: %s\n' "$*" >&2; FAILURES=$((FAILURES + 1)); }
pass() { printf '[backup] ok:   %s\n' "$*" >&2; }

restore() { # restore LABEL pg_restore-args...
  local label="$1"; shift
  if ex pg_restore -U supabase_admin -h 127.0.0.1 -d postgres --no-owner --no-acl "$@" >"$LOG" 2>&1; then
    pass "$label restored cleanly"
  else
    fail "$label had restore errors:"
    sanitized_errors >&2
  fi
}

# 1. auth accounts. The image ships a stale, partial auth schema (no
#    identities table, fewer users columns), so recreate both tables from the
#    definition captured in the backup.
log "restoring auth accounts"
rpsql -c "drop table if exists auth.identities, auth.users cascade" >/dev/null
restore "auth.users + auth.identities" -n auth -t users -t identities /backup/auth.dump

# 2. app schemas. The dump contains `CREATE SCHEMA public`, which already
#    exists on every Supabase database, so that single entry is filtered out of
#    the restore list (the runbook does the same).
log "restoring app schemas (public + drizzle)"
ex sh -c "pg_restore -l /backup/app.dump | grep -vE ' SCHEMA - public ' > /tmp/app.list"
restore "public + drizzle" -L /tmp/app.list /backup/app.dump

# 3 + 4. the documented post-restore steps
log "re-applying drizzle/0003 (auth triggers) and 0002 (revoke grants)"
for step in 0003 0002; do
  if ex sh -c "PGPASSWORD='$PW' psql -U supabase_admin -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q -f /migrations/${step}_*.sql" >"$LOG" 2>&1; then
    pass "drizzle/$step applied"
  else
    fail "drizzle/$step failed to apply"
  fi
done

# ─── assertions ──────────────────────────────────────────────────────────────
log "checking restored data against the manifest"

# Every table in the manifest exists and holds at least as many rows as when
# the manifest was written (the dump is taken after the counts, so rows added
# in between are fine; missing rows are not).
#
# The manifest is read on fd 3 and docker gets /dev/null as stdin: `docker exec -i`
# would otherwise swallow the rest of the manifest and the loop would quietly
# check one table and report success.
CHECKED=0
while IFS='|' read -r -u 3 kind name expected; do
  [ "$kind" = "count" ] || continue
  CHECKED=$((CHECKED + 1))
  actual="$(rpsql -c "select count(*) from $name" </dev/null 2>/dev/null || echo missing)"
  if [ "$actual" = "missing" ]; then
    fail "$name is missing after restore"
  elif [ "$actual" -lt "$expected" ]; then
    fail "$name has $actual rows, manifest expected at least $expected"
  else
    pass "$name: $actual rows (manifest $expected)"
  fi
done 3< "$DIR/manifest.txt"

# Guard against the loop silently checking fewer tables than the manifest lists.
EXPECTED_CHECKS="$(grep -c '^count|' "$DIR/manifest.txt")"
if [ "$CHECKED" -ne "$EXPECTED_CHECKS" ] || [ "$CHECKED" -eq 0 ]; then
  fail "checked $CHECKED tables but the manifest lists $EXPECTED_CHECKS"
fi

check() { # check DESCRIPTION EXPECTED SQL
  local desc="$1" want="$2" got
  got="$(rpsql -c "$3" </dev/null 2>/dev/null || echo error)"
  if [ "$got" = "$want" ]; then pass "$desc"; else fail "$desc (got '$got', want '$want')"; fi
}

check "RLS is enabled on every public table" 0 \
  "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity"

check "anon/authenticated hold no grants on public tables" 0 \
  "select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon','authenticated')"

check "the 3 auth-sync triggers exist" 3 \
  "select count(*) from pg_trigger where not tgisinternal
   and tgname in ('on_auth_user_created','on_auth_user_contact_updated','on_public_user_role_changed')"

check "every profile row has a matching auth account" 0 \
  "select count(*) from public.users u left join auth.users a on a.id = u.id where a.id is null"

if [ "$FAILURES" -gt 0 ]; then
  die "restore test FAILED with $FAILURES problem(s)"
fi
log "restore test passed"
