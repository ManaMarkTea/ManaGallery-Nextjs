#!/usr/bin/env bash
set -euo pipefail
umask 077
base=/srv/rendergallery-backups
export RESTIC_REPOSITORY="$base/repository"
export RESTIC_PASSWORD_FILE=/etc/rendergallery-backup.password
export RESTIC_CACHE_DIR="$base/cache"
exec 9>"$base/backup.lock"
flock -x 9
mode=${1:-backup}
case "$mode" in
  backup)
    available=$(df -B1 --output=avail "$base" | tail -n 1 | tr -d ' ')
    test "$available" -ge 2147483648 || { echo 'Backup skipped: less than 2 GiB free.'; exit 1; }
    python3 /usr/local/lib/rendergallery-backup/backup-snapshot.py create --output "$base/stage" --config /etc/rendergallery.env --config /etc/rendergallery-environment.json --config /etc/caddy/Caddyfile --config /etc/caddy/sites-enabled/rendergallery.caddy --config /etc/systemd/system/rendergallery.service
    restic backup --ignore-ctime --tag rendergallery "$base/stage"
    ;;
  maintenance)
    restic forget --tag rendergallery --keep-hourly 24 --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
    restic check --read-data
    ;;
  restore-check)
    available=$(df -B1 --output=avail "$base" | tail -n 1 | tr -d ' ')
    test "$available" -ge 5368709120 || { echo 'Restore drill skipped: less than 5 GiB free.'; exit 1; }
    drill=$(mktemp -d "$base/restore-check.XXXXXX")
    trap 'rm -rf -- "$drill"' EXIT
    restic restore latest --tag rendergallery --target "$drill"
    python3 /usr/local/lib/rendergallery-backup/backup-snapshot.py verify --output "$drill$base/stage"
    ;;
  *) echo 'Expected backup, maintenance, or restore-check'; exit 1 ;;
esac
# The administrator can download encrypted repository files over existing SSH.
# Staging, configuration and encryption keys remain private to root.
group=$(cat /etc/rendergallery-backup.group)
chgrp -R "$group" "$RESTIC_REPOSITORY"
find "$RESTIC_REPOSITORY" -type d -exec chmod 750 {} +
find "$RESTIC_REPOSITORY" -type f -exec chmod 640 {} +
chgrp "$group" "$base/backup.lock"
chmod 640 "$base/backup.lock"
date -u +'%Y-%m-%dT%H:%M:%SZ' > "$base/last-success-$mode"
