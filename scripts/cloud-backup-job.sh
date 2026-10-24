#!/usr/bin/env bash
set -euo pipefail
umask 077
base=/srv/rendergallery-backups
# Root-owned, mode 600; contains only settings entered by the administrator.
set -a
source /etc/rendergallery-cloud.env
set +a
export RESTIC_PASSWORD_FILE=/etc/rendergallery-backup.password
export RESTIC_FROM_PASSWORD_FILE="$RESTIC_PASSWORD_FILE"
export RESTIC_FROM_REPOSITORY="$base/repository"
export RESTIC_CACHE_DIR="$base/cloud-cache"
exec 9>"$base/backup.lock"
flock -x 9
case "${1:-copy}" in
  init) restic init --copy-chunker-params ;;
  copy)
    # Copy snapshots, not a raw bucket mirror: local pruning cannot erase cloud history.
    restic copy --tag rendergallery
    restic check
    ;;
  maintenance)
    restic forget --tag rendergallery --keep-hourly 24 --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
    restic check --read-data
    ;;
  restore-check)
    available=$(df -B1 --output=avail "$base" | tail -n 1 | tr -d ' ')
    test "$available" -ge 5368709120 || { echo 'Cloud restore drill requires 5 GiB free.'; exit 1; }
    drill=$(mktemp -d "$base/cloud-restore.XXXXXX")
    trap 'rm -rf -- "$drill"' EXIT
    restic restore latest --tag rendergallery --target "$drill"
    python3 /usr/local/lib/rendergallery-backup/backup-snapshot.py verify --output "$drill$base/stage"
    ;;
  *) echo 'Expected init, copy, maintenance, or restore-check'; exit 1 ;;
esac
date -u +'%Y-%m-%dT%H:%M:%SZ' > "$base/last-success-cloud-${1:-copy}"
