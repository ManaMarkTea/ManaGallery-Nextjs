# Site health and upload storage

Administrators can open **Admin → Site health** to see server disk headroom,
uploaded artwork usage, and the six local/cloud backup jobs. The overview shows
a warning when a backup job fails, becomes overdue, or its timer is inactive.
The page is read-only and is unavailable to ordinary members and guests.

On Linux, the website reads only fixed `systemctl show` properties. It does not
use sudo, read backup credentials, read the journal, or start/modify services.
Windows development and machines without systemd show monitoring unavailable,
never an assumed successful backup. No environment/credential changes are needed
for the existing Ubuntu installation.

Times show the visitor's browser timezone alongside UTC, including the check time
and last/next backup runs. Without JavaScript, UTC remains visible.
The last completed run may have failed: check its status as well
as its time. A service without completion evidence is awaiting its first run;
systemd may reset that history after a reboot. Local backups are flagged overdue
after three hours; daily cloud copies after 36 hours; weekly checks after nine
days; monthly restores after 35 days. These margins allow scheduler jitter.
This is an admin dashboard, not email/push alerting or an independent uptime
monitor. Review [backup recovery](backups.md) and [cloud setup](backblaze.md).

## Expandable backup logs

Each backup check has **View log**, showing a snapshot of the latest 40 journal
entries with local and UTC timestamps. Log text is escaped as text, never HTML.
The snapshot refreshes about once per minute; an old snapshot is labeled stale.

Install the protected log publisher once from a directory containing both scripts:

```sh
sudo bash scripts/setup-backup-log-monitor.sh
# Optionally retry the cloud copy immediately after installing:
sudo bash scripts/setup-backup-log-monitor.sh --retry-cloud
```

The root-owned publisher reads only the six fixed backup units. It removes known
backup credentials, credential assignments and remote repository URLs before
writing `/var/lib/rendergallery-monitor/backup-logs.json` atomically. That directory
is root-owned; the app group can read the snapshot but cannot modify it. The app
gets no journal membership, sudo rules, service controls or new privileges, and
its `NoNewPrivileges` sandbox remains enabled. The web page only reads the
bounded snapshot after checking admin access. No raw journal API is exposed.

Ordinary Git deployments cannot install/replace this root-owned publisher, so
its first installation or later infrastructure updates require normal sudo.
The full environment installer includes it when local backups are selected.

## Upload quotas

**Admin → Settings** controls the total uploaded-artwork allowance and the
per-member allowance, in MiB. Defaults are 2,048 MiB for the gallery and 1,024 MiB
per member. Both encoded originals and previews count, including pending/hidden
uploads. All uploaders, including admins and trusted members, obey these limits.
Existing artwork is preserved when limits are lowered; new uploads wait until
there is room. Imported legacy images, models and materials are outside these
upload quotas but still use the shared server disk.

New uploads also require at least 2 GiB of filesystem space to remain available
after their bytes are written. This reserve is separate from the quotas and
cannot be disabled from the admin panel. Deployments and restore drills need
more headroom; their own checks still apply.

Image decoding happens before taking the database write lock. The final quota
check, file writes and upload-row insertion occur together under that lock with
no asynchronous gap. Simultaneous submissions cannot both claim the last space,
and backup staging cannot see a committed upload without its files. Failed
writes/insertions roll back and remove files created by that attempt. Existing
orphan files count against the total allowance rather than silently using space.

The single-process synchronous storage scan favors correctness and the current
small upload collection. At larger scale, replace it with transactional byte
accounting/reservations and periodic reconciliation before adding app instances.

## Cloud cap recovery

A download cap can block repository metadata reads as well as full verification,
so uploading a new backup can fail despite free inbound bandwidth. After fixing
the cap, the next scheduled daily job retries automatically. To retry sooner:

```sh
sudo systemctl start rendergallery-cloud-copy.service
systemctl show rendergallery-cloud-copy.service -p Result -p ExecMainExitTimestamp
```

This is server maintenance and still requires normal sudo authentication. A site
deployment cannot trigger privileged backup jobs or change their credentials.
Until a successful cloud copy is recorded, recent changes may exist only in the
local encrypted snapshots. Existing successful cloud snapshots remain available.
