#!/usr/bin/env bash
# The whole nightly job: dump -> encrypt -> restore-test.
#
# Usage: DIRECT_URL=... BACKUP_AGE_RECIPIENT=age1... scripts/backup/run.sh
#   BACKUP_OUT  where the encrypted file lands (default: ./backups, git-ignored)
#
# Plaintext exists only in a temp directory that is deleted on exit, however
# the script ends. Only the encrypted file is meant to leave this machine.
#
# Order matters: the encrypted copy is written BEFORE the restore test. If the
# test fails (or the test itself is buggy) you still have that night's backup;
# the non-zero exit is what raises the alarm. A failed run never ends silently
# with no backup and no alert.

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_env DIRECT_URL BACKUP_AGE_RECIPIENT
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${BACKUP_OUT:-$REPO_ROOT/backups}"

WORK="$(mktemp -d)"
# The restore-test container runs as a different user than the caller and must
# be able to read the mounted files (matters on Linux runners).
chmod 755 "$WORK"
trap 'rm -rf "$WORK"' EXIT

bash "$SCRIPTS/dump.sh" "$WORK"
FILE="$(bash "$SCRIPTS/encrypt.sh" "$WORK" "$OUT")"

status=0
bash "$SCRIPTS/restore-test.sh" "$WORK" || status=$?

if [ "$status" -eq 0 ]; then
  log "backup OK and verified restorable: $FILE"
else
  log "backup written but the RESTORE TEST FAILED: $FILE. Investigate before trusting it."
fi
exit "$status"
