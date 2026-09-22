#!/usr/bin/env bash
# Shared helpers for the backup scripts. Source this file; don't execute it.
#
# Everything that touches Postgres runs inside a Docker container so the same
# scripts behave identically on a laptop and on a GitHub Actions runner, with
# no local pg_dump/psql version to match. The database URL is passed to
# containers by NAME (-e DIRECT_URL), never as an argument, so it can't show
# up in `ps` output or shell traces.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

log() { printf '[backup] %s\n' "$*" >&2; }
die() { printf '[backup] error: %s\n' "$*" >&2; exit 1; }

require_env() {
  local v
  for v in "$@"; do
    [ -n "${!v:-}" ] || die "$v is not set"
  done
}

require_docker() {
  docker info >/dev/null 2>&1 || die "Docker is not running"
}

# Restore-test target: a Supabase-flavoured Postgres (auth schema and the
# anon/authenticated/service_role roles already exist), pinned per major so
# runs are reproducible. Bump these when Supabase moves your project's major.
supabase_image_for_major() {
  case "$1" in
    15) echo "supabase/postgres:15.14.1.175" ;;
    17) echo "supabase/postgres:17.6.1.175" ;;
    *) die "unsupported Postgres major '$1'; add an image to scripts/backup/lib.sh" ;;
  esac
}

# Run psql against the SOURCE database (DIRECT_URL). SQL comes from stdin.
# $1 = Postgres major for the client image (17 is fine for the first probe:
# a newer client can always talk to an older server).
src_psql() {
  docker run --rm -i -e DIRECT_URL "postgres:${1:-17}" \
    sh -c 'psql "$DIRECT_URL" -At -v ON_ERROR_STOP=1'
}

detect_pg_major() {
  local num
  num="$(echo "show server_version_num;" | src_psql 17)" \
    || die "cannot connect to the database (is DIRECT_URL the session-pooler URL, port 5432?)"
  echo $(( num / 10000 ))
}

# ─── age (public-key file encryption) ────────────────────────────────────────
# Uses a local `age` when present (GitHub runners: apt install age). Otherwise
# falls back to a throwaway Alpine container so a laptop needs nothing extra.

have_local_age() {
  command -v age >/dev/null 2>&1 && command -v age-keygen >/dev/null 2>&1
}

# age_encrypt RECIPIENT: plaintext on stdin, ciphertext on stdout.
age_encrypt() {
  if have_local_age; then
    age -r "$1"
  else
    docker run --rm -i -e AGE_RECIPIENT="$1" alpine:3 \
      sh -c 'apk add -q --no-cache age >/dev/null 2>&1 && age -r "$AGE_RECIPIENT"'
  fi
}

# Proves the age tooling can encrypt AND decrypt in this environment, using a
# throwaway keypair. It cannot prove Sam's real key works (the private half is
# deliberately never here): that is what the periodic restore drill is for.
age_selftest() {
  local snippet='
    set -e
    d="$(mktemp -d)"
    age-keygen -o "$d/k" >/dev/null 2>&1
    pub="$(age-keygen -y "$d/k")"
    printf probe | age -r "$pub" -o "$d/c"
    [ "$(age -d -i "$d/k" "$d/c")" = probe ]
  '
  if have_local_age; then
    sh -c "$snippet"
  else
    docker run --rm alpine:3 sh -c "apk add -q --no-cache age >/dev/null 2>&1 && $snippet"
  fi
}
