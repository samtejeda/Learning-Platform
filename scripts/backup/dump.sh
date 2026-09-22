#!/usr/bin/env bash
# Dump the database into OUTDIR as three plaintext files (app.dump, auth.dump, manifest.txt):
#
#   app.dump        pg_dump custom format: schemas `public` + `drizzle`
#                   (tables, data, RLS flags, grants, functions, migration
#                   journal). rate_limit_buckets keeps its structure but not
#                   its rows: those counters are ephemeral.
#   auth.dump       auth.users + auth.identities, definition AND data. In a
#                   real recovery into a fresh Supabase project restore it
#                   `--data-only` (the project already has current tables);
#                   the restore test recreates the two tables from the
#                   captured definition because its image ships a stale
#                   auth schema. Triggers on auth.users are NOT restored from
#                   here: re-applying drizzle/0003 recreates them.
#   manifest.txt    Counts only (no data): the oracle for the restore test.
#
# PLAINTEXT CONTAINS STUDENT ACCOUNT DATA. Callers must encrypt or delete it
# (run.sh does both). Never point OUTDIR inside the repo.
#
# Usage: DIRECT_URL=... scripts/backup/dump.sh OUTDIR
#   DIRECT_URL must be the Supabase SESSION-pooler URL (port 5432). The
#   db.<ref>.supabase.co direct host is IPv6-only and unreachable from GitHub
#   runners.

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

OUT="${1:-}"
[ -n "$OUT" ] || die "usage: dump.sh OUTDIR"
require_env DIRECT_URL
require_docker
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

PG_MAJOR="$(detect_pg_major)"
log "source is Postgres $PG_MAJOR"

# Counts are taken BEFORE the dump so the dump's snapshot is at least as new:
# the restore test then asserts restored >= manifest, which tolerates rows
# inserted in between but still catches anything missing.
log "writing manifest"
{
  echo "# backup manifest: counts only, no row data"
  echo "created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "git_sha=${GITHUB_SHA:-$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
  echo "pg_major=$PG_MAJOR"
  src_psql "$PG_MAJOR" <<'SQL'
select 'count|public.' || table_name || '|' ||
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
  and table_name <> 'rate_limit_buckets'
order by table_name;
select 'count|drizzle.__drizzle_migrations|' || count(*) from drizzle.__drizzle_migrations;
select 'count|auth.users|' || count(*) from auth.users;
select 'count|auth.identities|' || count(*) from auth.identities;
SQL
} > "$OUT/manifest.txt"

# --user keeps the output files owned by the caller (matters on Linux runners).
dump() {
  docker run --rm --user "$(id -u):$(id -g)" -e DIRECT_URL -v "$OUT:/out" \
    "postgres:$PG_MAJOR" sh -c "$1"
}

log "dumping app schemas (public + drizzle)"
dump 'pg_dump "$DIRECT_URL" --format=custom --no-owner \
  --schema=public --schema=drizzle \
  --exclude-table-data=public.rate_limit_buckets \
  --file=/out/app.dump'

log "dumping auth accounts (auth.users + auth.identities)"
dump 'pg_dump "$DIRECT_URL" --format=custom --no-owner --no-privileges \
  --table=auth.users --table=auth.identities \
  --file=/out/auth.dump'

for f in app.dump auth.dump manifest.txt; do
  [ -s "$OUT/$f" ] || die "$f is missing or empty"
done
log "dump complete: $(cd "$OUT" && du -sh . | cut -f1) in $OUT"
