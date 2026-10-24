#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$(id -u)" -eq 0 || { echo 'Run once with sudo bash.'; exit 1; }
mode=${1:-install}
[[ "$mode" = install || "$mode" = --retry-cloud ]] && [ "$#" -le 1 ] || { echo 'Usage: setup-backup-log-monitor.sh [--retry-cloud]'; exit 1; }
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
getent group rendergallery >/dev/null
test ! -L /var/lib/rendergallery-monitor
test ! -L /usr/local/lib/rendergallery-monitor
install -d -o root -g root -m 700 /usr/local/lib/rendergallery-monitor
install -d -o root -g rendergallery -m 750 /var/lib/rendergallery-monitor
install -o root -g root -m 700 "$source_dir/publish-backup-logs.py" /usr/local/lib/rendergallery-monitor/publish-backup-logs.py
cat > /etc/systemd/system/rendergallery-log-monitor.service <<'EOF'
[Unit]
Description=Publish redacted RenderGallery backup logs
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 -I /usr/local/lib/rendergallery-monitor/publish-backup-logs.py
User=root
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/rendergallery-monitor
TimeoutStartSec=45
EOF
cat > /etc/systemd/system/rendergallery-log-monitor.timer <<'EOF'
[Unit]
Description=Refresh RenderGallery backup log tails
[Timer]
OnBootSec=30
OnUnitActiveSec=60
AccuracySec=5
[Install]
WantedBy=timers.target
EOF
chmod 644 /etc/systemd/system/rendergallery-log-monitor.{service,timer}
systemctl daemon-reload
systemctl start rendergallery-log-monitor.service
systemctl enable --now rendergallery-log-monitor.timer
echo 'Read-only backup log publishing is installed. No journal permissions or sudo access were given to the web app.'
if [ "$mode" = --retry-cloud ]; then
    echo 'Retrying the cloud backup with the current Backblaze cap…'
    result=0
    systemctl start rendergallery-cloud-copy.service || result=$?
    systemctl start rendergallery-log-monitor.service
    systemctl show rendergallery-cloud-copy.service -p Result -p ExecMainExitTimestamp
    exit "$result"
fi
