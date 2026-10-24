#!/usr/bin/env bash
# Deploy a verified staging build without replacing live account/upload data.
set -euo pipefail
log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
test "$(id -u)" -eq 0 || { echo 'Run with sudo bash.'; exit 1; }
stage=$(realpath -e "${1:?Provide the verified staging directory}")
test -f "$stage/app/.next/BUILD_ID"
test -d /srv/rendergallery/app
test ! -e /srv/rendergallery/app.next || { echo 'An unfinished deployment exists at app.next; inspect it first.'; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
if [ -f /srv/rendergallery-backups/backup.lock ]; then
    log 'Waiting for any backup job to finish…'
    exec 9>/srv/rendergallery-backups/backup.lock
    flock -x 9
fi
install -d -m 700 /srv/rendergallery-backups
log 'Taking a consistent database backup…'
python3 - "$stamp" <<'PY'
import sqlite3,sys
with sqlite3.connect('/srv/rendergallery-data/gallery.sqlite') as source:
    with sqlite3.connect('/srv/rendergallery-backups/before-'+sys.argv[1]+'.sqlite') as target:
        source.backup(target)
        target.execute('PRAGMA journal_mode=DELETE')
PY
log 'Copying the app and image archive (this can take several minutes)…'
cp -a "$stage/app" /srv/rendergallery/app.next
log 'Copy finished. Preparing permissions and model downloads…'
if [ -d "$stage/data/models" ]; then
    install -d -o rendergallery -g rendergallery -m 700 /srv/rendergallery-data/models
    cp -a "$stage/data/models/." /srv/rendergallery-data/models/
    chown -R rendergallery:rendergallery /srv/rendergallery-data/models
    chmod -R go-rwx /srv/rendergallery-data/models
fi
if [ -x /usr/local/sbin/rendergallery-backup ]; then
    install -m 700 "$stage/app/scripts/backup-snapshot.py" /usr/local/lib/rendergallery-backup/backup-snapshot.py
fi
chown -R root:rendergallery /srv/rendergallery/app.next
chmod -R g+rX,o-rwx /srv/rendergallery/app.next
chown -R rendergallery:rendergallery /srv/rendergallery/app.next/.next/cache
log 'Stopping the app briefly to update the schema and switch versions…'
systemctl stop rendergallery
trap 'systemctl start rendergallery' EXIT
python3 - "$stage" <<'PY'
import json,sqlite3,sys
from pathlib import Path
stage=Path(sys.argv[1])
with sqlite3.connect('/srv/rendergallery-data/gallery.sqlite') as db:
    db.executescript((stage/'app/lib/member-schema.sql').read_text())

PY
mv /srv/rendergallery/app "/srv/rendergallery/app.before-$stamp"
if ! mv /srv/rendergallery/app.next /srv/rendergallery/app; then
    mv "/srv/rendergallery/app.before-$stamp" /srv/rendergallery/app
    exit 1
fi
# Let the health-check path handle a start failure and restore the old release.
log 'Starting the app and waiting for its health check…'
systemctl start rendergallery || true
healthy=false
for attempt in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:3000/ -o /dev/null 2>/dev/null; then healthy=true; break; fi
    sleep 1
done
if [ "$healthy" != true ]; then
    systemctl stop rendergallery
    mv /srv/rendergallery/app "/srv/rendergallery/app.failed-$stamp"
    mv "/srv/rendergallery/app.before-$stamp" /srv/rendergallery/app
    systemctl start rendergallery
    echo 'Health check failed; previous code restored. Additive database changes retained.'
    exit 1
fi
trap - EXIT
log "Updated successfully. Previous code and database backup retained ($stamp)."
