# Backup and recovery

## What is protected

- GitHub holds source code, not accounts or artwork.
- Restic holds encrypted, deduplicated snapshots of the private SQLite database, referenced uploads/previews, materials and 3D models with their catalogues, imported public archive, and application/Caddy/systemd configuration.
- An independent PC or cloud copy is required for losing the entire VPS. A repository on the VPS alone is not disaster recovery. The hosting provider's weekly DR backup is an additional layer, not the only recovery method.

The database staging copy uses SQLite's backup API. A short write lock keeps the database and referenced immutable upload files consistent while hard links are taken; hashing and archive linking happen after the lock is released. The website is not stopped. Staging and uploads must share a filesystem. Do not change uploaded file bytes in place; current upload routes create new immutable files. Do not run an archive/material re-import concurrently with a backup; a mismatched material catalogue causes verification to fail.

Staging directories are private and explicitly marked as owned by the backup tool. Cleanup refuses to replace unrelated directories. The tests exercise active WAL databases, later live deletions, corrupt restores, unsafe destinations and an encrypted restic round trip.

## Install on the VPS

Requires Python 3.11+, Ubuntu, systemd, and the existing deployment paths. The installer installs restic from Ubuntu's repository. Review the three backup scripts, then run from their shared scripts directory:

```sh
sudo bash scripts/setup-backups.sh YOUR_SSH_ADMIN_USERNAME
```

This creates the encrypted repository at `/srv/rendergallery-backups/repository`, takes an initial backup and performs a full restore drill before enabling the timers. No data is sent to an external service by this installer.

Schedules:

| Job | Schedule |
| --- | --- |
| Snapshot | Hourly, with up to five minutes of jitter |
| Retention/prune and full authenticated data check | Sundays at 04:35 UTC |
| Full disposable restore and manifest/database verification | First day of each month at 05:20 UTC |

Retention keeps 24 hourly, 7 daily, 4 weekly and 6 monthly restore points; these overlap rather than storing independent full copies. The job serializes backup, maintenance, restore and off-server download operations through a shared lock. It skips a backup below 2 GiB free, or a restore drill below 5 GiB free, and reports failure in systemd. Those thresholds are safety margins, not a guarantee that future growth will fit. Review disk use as uploads grow.

Status and manual checks:

```sh
systemctl list-timers 'rendergallery-*'
sudo journalctl -u rendergallery-backup -n 50 --no-pager
sudo journalctl -u rendergallery-maintenance -n 50 --no-pager
sudo journalctl -u rendergallery-restore-check -n 50 --no-pager
sudo cat /srv/rendergallery-backups/last-success-backup
sudo systemctl start rendergallery-backup.service
```

Failed services remain visible in `systemctl --failed` and **Admin → Site health**. See [operations.md](operations.md). Email/push alerts are not configured. A successful last snapshot does not prove subsequent jobs are running; inspect its timestamp and service status.

## Encryption key

The installer generates a random recovery password at `/etc/rendergallery-backup.password` and gives the specified SSH administrator a private copy at `~/.config/rendergallery-backup/recovery-password`. It never prints the password or commits it to Git. Fetch the private copy over SSH and keep it in a password manager or another independently protected location. Do not put it inside the encrypted repository export.

**Losing both password copies makes the encrypted backups unrecoverable.** Restic's encrypted repository contains wrapped keys, not a substitute for the recovery password. See the [official repository guide](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html).

## Off-server copy to a PC

The script requires Python 3.11+ and SSH key-only login working from the account that runs it:

```sh
python scripts/pull-server-backup.py --host ADMIN@SERVER --destination /private/path/server-backups
```

It takes a shared lock while downloading the encrypted repository, so pruning cannot invalidate the export. It verifies the tar structure and repository snapshot presence, records a SHA256 checksum and completion marker, and keeps three completed exports by default. It never deletes older copies before a new download succeeds. These exports contain encrypted account/artwork/config data and must not be committed to Git.

Schedule this daily in Windows Task Scheduler or cron once the private destination and SSH-agent/key access are chosen. A powered-off PC or unavailable key cannot receive a backup. Until this is scheduled and its first transfer checked, the off-server layer is incomplete. A daily pull targets at most one day of loss in a total VPS failure; hourly local snapshots target about one hour for ordinary application recovery.

For automated off-server storage, use the [Backblaze B2 setup](backblaze.md). It creates an independent encrypted repository and copies snapshots using restic, rather than mirroring deletions from the local repository. Cloud account creation and credentials are still required.

## Restore drill and disaster recovery

The scheduled drill restores the newest snapshot into a temporary directory, checks file counts and sizes, validates database integrity and upload references, and compares checksums for database/uploads/materials/configuration. It also checks .MAT bytes against their catalogue. Archive image bytes are authenticated by restic's full data check. It does not overwrite the running app or exercise every browser workflow.

For an actual recovery, use a separate destination first:

1. Verify the downloaded tar against its `.sha256` file and unpack it into an empty private directory. Install restic and retrieve the separate recovery password.
2. Run `restic -r REPOSITORY --password-file PASSWORD_FILE check --read-data`.
3. Run `restic -r REPOSITORY --password-file PASSWORD_FILE restore latest --tag rendergallery --target /private/recovery`.
4. Verify the restored staging tree using `python scripts/backup-snapshot.py verify --output /private/recovery/srv/rendergallery-backups/stage`.
5. Rebuild the application from GitHub on the new server. Stop the app before replacing its data; preserve the existing data directory as a rollback copy. Restore the snapshot's `data/` to `/srv/rendergallery-data`, owned by the `rendergallery` service account. Restore `public/` into the app's public directory.
6. Review restored environment/Caddy/systemd configuration for the current domain and paths before installing it. Start the service and verify sign-in, an existing image, a material download and an upload/approval flow. Restore DNS only when the target is ready.

Keep the encrypted off-server copy and recovery password after a successful drill. The disposable drill directory is automatically removed; the repository and live files are retained.
