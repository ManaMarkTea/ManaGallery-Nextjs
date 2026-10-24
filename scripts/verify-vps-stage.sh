#!/usr/bin/env bash
set -euo pipefail
stage=${1:?Provide the staging directory}
site_host=${2:?Provide the site hostname}
export PATH="$stage/node/bin:/usr/local/bin:/usr/bin:/bin"
export APP_ORIGIN="https://${site_host}"
export RENDERGALLERY_DATA_DIR="$stage/data"
export ADSENSE_ENABLED=false
export NEXT_TELEMETRY_DISABLED=1
cd "$stage/app"
if [ "${3:-}" != "--skip-build" ]; then
    npm run lint
    npm run build
fi
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100 > "$stage/smoke.log" 2>&1 &
smoke_pid=$!
trap 'kill "$smoke_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 30); do
    if curl --connect-timeout 2 --max-time 3 -fsS http://127.0.0.1:3100/ -o "$stage/smoke.html" 2> "$stage/smoke-startup-error.log"; then break; fi
    if [ "$attempt" -eq 30 ]; then
        echo 'Staging server did not become healthy.'
        cat "$stage/smoke-startup-error.log"
        tail -n 20 "$stage/smoke.log"
        exit 1
    fi
    sleep 1
done
curl -fsS http://127.0.0.1:3100/ads.txt -o "$stage/smoke-ads.txt"
python3 - "$stage" <<'PY'
from pathlib import Path
import sqlite3, sys
stage = Path(sys.argv[1])
html = (stage / 'smoke.html').read_text()
assert 'Image gallery' in html
assert 'adsbygoogle.js' not in html
assert 'Advertising is disabled' in (stage / 'smoke-ads.txt').read_text()
with sqlite3.connect(stage / 'data/gallery.sqlite') as db:
    settings = dict(db.execute('SELECT key,value FROM site_settings'))
    assert settings['registrationOpen'] == 'false'
    assert settings['adsenseEnabled'] == 'false'
    assert db.execute('SELECT count(*) FROM sessions').fetchone()[0] == 0
print('Linux build and HTTP smoke checks passed; test database is isolated, registration and ads are disabled.')
PY
