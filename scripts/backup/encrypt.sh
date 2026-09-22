#!/usr/bin/env bash
# Bundle DIR/{app.dump,auth.dump,manifest.txt} into ONE age-encrypted file.
#
# Usage: BACKUP_AGE_RECIPIENT=age1... scripts/backup/encrypt.sh DIR OUTDIR
#   -> OUTDIR/backup-<UTC timestamp>.tar.age
#
# BACKUP_AGE_RECIPIENT is a PUBLIC key (starts with "age1"). Only the holder of
# the matching private key can decrypt: keep that offline, never in GitHub.
#
# Decrypt (see docs/RUNBOOK.md):
#   age -d -i key.txt backup-....tar.age | tar -xf -

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DIR="${1:-}"
OUT="${2:-}"
[ -n "$DIR" ] && [ -n "$OUT" ] || die "usage: encrypt.sh DIR OUTDIR"
require_env BACKUP_AGE_RECIPIENT
case "$BACKUP_AGE_RECIPIENT" in
  age1*) ;;
  *) die "BACKUP_AGE_RECIPIENT must be an age PUBLIC key starting with 'age1' (never paste a private key)" ;;
esac
for f in app.dump auth.dump manifest.txt; do
  [ -s "$DIR/$f" ] || die "$DIR/$f is missing or empty"
done
mkdir -p "$OUT"

# Local `age` if present, else a throwaway container. Both paths are covered by
# the self-test so a broken toolchain fails the run instead of producing junk.
log "checking age can encrypt and decrypt here"
age_selftest || die "age self-test failed; refusing to produce a backup we can't trust"

FILE="$OUT/backup-$(date -u +%Y%m%dT%H%M%SZ).tar.age"
log "encrypting"
tar -C "$DIR" -cf - app.dump auth.dump manifest.txt | age_encrypt "$BACKUP_AGE_RECIPIENT" > "$FILE" \
  || { rm -f "$FILE"; die "encryption failed"; }
[ -s "$FILE" ] || { rm -f "$FILE"; die "encrypted file is empty"; }

# A real age file starts with this header; anything else means something wrote
# plaintext or an error message into the artifact.
head -c 22 "$FILE" | grep -q '^age-encryption.org/v1' \
  || { rm -f "$FILE"; die "output is not an age file"; }

log "wrote $FILE ($(du -h "$FILE" | cut -f1))"
echo "$FILE"
