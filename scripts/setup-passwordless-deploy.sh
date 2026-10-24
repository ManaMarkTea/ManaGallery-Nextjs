#!/usr/bin/env bash
# One-time bootstrap. Subsequent promotions need no password, but only this helper.
set -euo pipefail
umask 077
test "$(id -u)" -eq 0 || { echo 'Run once with sudo bash.'; exit 1; }
admin=${1:?Provide the SSH administrator username}
[[ "$admin" =~ ^[a-z_][a-z0-9_-]*$ ]]
test "$(id -u "$admin")" -ne 0
admin_home=$(getent passwd "$admin" | cut -d: -f6)
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
test -f "$source_dir/promote-vps.py"
test -d /srv/rendergallery/app
install -o root -g root -m 755 "$source_dir/promote-vps.py" /usr/local/sbin/rendergallery-promote
python3 - "$admin" "$admin_home/rendergallery-git-stage" <<'PY'
import json,sys
from pathlib import Path
p=Path('/etc/rendergallery-deploy.json')
p.write_text(json.dumps({'user':sys.argv[1],'stage':sys.argv[2],'reuseArchive':True}))
p.chmod(0o600)
PY
rule=$(mktemp)
trap 'rm -f -- "$rule"' EXIT
# An explicit empty argument string disallows all helper arguments in sudoers.
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/rendergallery-promote ""\n' "$admin" > "$rule"
visudo -cf "$rule"
install -o root -g root -m 440 "$rule" /etc/sudoers.d/rendergallery-deploy
visudo -cf /etc/sudoers.d/rendergallery-deploy
echo 'Passwordless promotion installed for this site only. No general sudo access was added.'
echo 'Next deployment: use scripts/deploy.ps1 locally, or the existing server pull command.'
