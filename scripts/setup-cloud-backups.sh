#!/usr/bin/env bash
# Interactive setup: credentials never appear in command arguments or Git.
set -euo pipefail
umask 077
test "$(id -u)" -eq 0 || { echo 'Run with sudo bash.'; exit 1; }
test -x /usr/local/sbin/rendergallery-backup || { echo 'Install local backups first using setup-backups.sh.'; exit 1; }
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
install -m 700 "$source_dir/cloud-backup-job.sh" /usr/local/sbin/rendergallery-cloud-backup
install -d -m 700 /srv/rendergallery-backups/cloud-cache
if [ ! -f /etc/rendergallery-cloud.env ]; then
    read -r -p 'B2 S3 endpoint (e.g. s3.us-west-004.backblazeb2.com): ' endpoint
    read -r -p 'Private bucket name: ' bucket
    [[ "$endpoint" =~ ^s3\.[a-z0-9-]+\.backblazeb2\.com$ ]]
    [[ "$bucket" =~ ^[a-zA-Z0-9-]{6,63}$ ]]
    read -r -s -p 'Application key ID (hidden): ' key_id; echo
    read -r -s -p 'Application key (hidden): ' key_secret; echo
    test -n "$key_id" && test -n "$key_secret"
    config=$(mktemp /etc/rendergallery-cloud.env.XXXXXX)
    trap 'rm -f -- "${config:-}"' EXIT
    printf 'RESTIC_REPOSITORY=%q\nAWS_ACCESS_KEY_ID=%q\nAWS_SECRET_ACCESS_KEY=%q\n' "s3:https://$endpoint/$bucket/rendergallery" "$key_id" "$key_secret" > "$config"
    chmod 600 "$config"
    mv "$config" /etc/rendergallery-cloud.env
    trap - EXIT
    unset key_id key_secret
fi
chmod 600 /etc/rendergallery-cloud.env
chown root:root /etc/rendergallery-cloud.env
if [ "${1:-}" = --init ]; then
    # Explicit initialization only: a network/auth failure must not create a new repository.
    /usr/local/sbin/rendergallery-cloud-backup init
fi
for mode in copy maintenance restore-check; do
    unit=rendergallery-cloud-$mode
    cat > "/etc/systemd/system/$unit.service" <<EOF
[Unit]
Description=RenderGallery encrypted cloud backup ($mode)
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/rendergallery-cloud-backup $mode
UMask=0077
Nice=10
IOSchedulingClass=idle
TimeoutStartSec=4h
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
EOF
    case "$mode" in
      copy)
        # Always create a fresh local snapshot before an off-server transfer.
        sed -i '/^ExecStart=/i ExecStartPre=/usr/local/sbin/rendergallery-backup backup' "/etc/systemd/system/$unit.service"
        schedule='*-*-* 06:10:00 UTC' ;;
      maintenance) schedule='Sun *-*-* 08:10:00 UTC' ;;
      restore-check) schedule='*-*-02 09:10:00 UTC' ;;
    esac
    cat > "/etc/systemd/system/$unit.timer" <<EOF
[Unit]
Description=Schedule RenderGallery cloud $mode
[Timer]
OnCalendar=$schedule
RandomizedDelaySec=300
Persistent=true
[Install]
WantedBy=timers.target
EOF
    chmod 644 "/etc/systemd/system/$unit.service" "/etc/systemd/system/$unit.timer"
done
systemctl daemon-reload
# Enable timers only after the initial transfer and a real cloud restore succeed.
systemctl start rendergallery-cloud-copy.service
systemctl start rendergallery-cloud-restore-check.service
systemctl enable --now rendergallery-cloud-copy.timer rendergallery-cloud-maintenance.timer rendergallery-cloud-restore-check.timer
echo 'Cloud transfer and restore verified; timers enabled. Save the recovery password separately in your password manager.'
