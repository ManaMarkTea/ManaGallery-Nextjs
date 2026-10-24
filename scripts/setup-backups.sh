#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$(id -u)" -eq 0 || { echo 'Run with sudo bash.'; exit 1; }
admin_user=${1:?Provide the SSH administrator username}
admin_group=$(id -gn "$admin_user")
admin_home=$(getent passwd "$admin_user" | cut -d: -f6)
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
test -f "$source_dir/backup-snapshot.py"
test -f "$source_dir/backup-job.sh"
test -f /srv/rendergallery-data/gallery.sqlite
apt-get update
apt-get install -y restic
base=/srv/rendergallery-backups
install -d -o root -g "$admin_group" -m 750 "$base"
install -d -o root -g root -m 700 "$base/cache" /usr/local/lib/rendergallery-backup
install -m 700 "$source_dir/backup-snapshot.py" /usr/local/lib/rendergallery-backup/backup-snapshot.py
install -m 700 "$source_dir/backup-job.sh" /usr/local/sbin/rendergallery-backup
printf '%s\n' "$admin_group" > /etc/rendergallery-backup.group
if [ ! -f /etc/rendergallery-backup.password ]; then
    test ! -e "$base/repository/config" || { echo 'Existing repository without its password file: refusing to replace its key.'; exit 1; }
    openssl rand -base64 32 > /etc/rendergallery-backup.password
fi
chmod 600 /etc/rendergallery-backup.password /etc/rendergallery-backup.group
export RESTIC_REPOSITORY="$base/repository"
export RESTIC_PASSWORD_FILE=/etc/rendergallery-backup.password
export RESTIC_CACHE_DIR="$base/cache"
if [ ! -f "$RESTIC_REPOSITORY/config" ]; then restic init; fi
# A separate private recovery-key copy can be fetched over the existing SSH
# account. Never place this password inside the encrypted repository archive.
install -d -o "$admin_user" -g "$admin_group" -m 700 "$admin_home/.config/rendergallery-backup"
install -o "$admin_user" -g "$admin_group" -m 600 /etc/rendergallery-backup.password "$admin_home/.config/rendergallery-backup/recovery-password"
touch "$base/backup.lock"
chown root:"$admin_group" "$base/backup.lock"
chmod 640 "$base/backup.lock"
for mode in backup maintenance restore-check; do
    unit=rendergallery-$mode
    cat > "/etc/systemd/system/$unit.service" <<EOF
[Unit]
Description=RenderGallery encrypted backup ($mode)
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/rendergallery-backup $mode
UMask=0077
Nice=10
IOSchedulingClass=idle
TimeoutStartSec=1h
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
EOF
    case "$mode" in
      backup) schedule=hourly ;;
      maintenance) schedule='Sun *-*-* 04:35:00 UTC' ;;
      restore-check) schedule='*-*-01 05:20:00 UTC' ;;
    esac
    cat > "/etc/systemd/system/$unit.timer" <<EOF
[Unit]
Description=Schedule RenderGallery $mode

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
echo 'Creating the first encrypted backup. Archive images may take a few minutes.'
systemctl start rendergallery-backup.service
echo 'Running an initial full restore drill into a disposable directory.'
systemctl start rendergallery-restore-check.service
systemctl enable --now rendergallery-backup.timer rendergallery-maintenance.timer rendergallery-restore-check.timer
systemctl list-timers 'rendergallery-*' --no-pager
echo 'Local encrypted backups are enabled. An off-server copy and the recovery password must also be kept independently.'
