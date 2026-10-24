# Encrypted Backblaze B2 backups

## Create the destination

1. Create a Backblaze B2 account, enable account MFA, and set billing/budget alerts.
2. Create a dedicated **private** bucket, for example `rendergallery-private-backups` (bucket names must be unique). Record its S3 endpoint from the bucket details.
3. Create a standard application key limited to this bucket, with **Read and Write** access and **Allow List All Bucket Names** for S3 compatibility. Do not use your master account key. Keep the key ID and application key in your password manager; the secret is shown only once.
4. For this restic repository, choose the bucket lifecycle **Keep only the last version of the file**, so hidden objects deleted during pruning do not accumulate indefinitely. Restic manages its own snapshot history. Do not create age-based rules that delete current files from the repository. Object Lock is not configured by these scripts.

The integration uses [restic's recommended S3 interface for B2](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html#backblaze-b2). Consult [Backblaze's S3-compatible key guide](https://www.backblaze.com/docs/cloud-storage-s3-compatible-app-keys) when creating the restricted key.

## Connect from the VPS

Install the [local backup layer](backups.md) first. Then, from the scripts directory:

```sh
sudo bash setup-cloud-backups.sh --init
```

Enter the endpoint hostname without `https://`, bucket name, key ID, and secret at the prompts. The credentials are hidden while typed and saved only in root-owned `/etc/rendergallery-cloud.env` with mode 600. Never paste secrets into GitHub, chat, command arguments or tracked files. There is no need to give this application key to the website's runtime account.

`--init` is for a new destination only. Restic refuses to initialize over an existing repository. If setup was interrupted after initialization, rerun **without** `--init`; it reuses the private configuration and resumes transfer. Authentication/network errors are not treated as evidence that a repository is empty.

Initialization copies the local repository's chunking parameters for efficient deduplication. Restic encrypts the new repository with its own encryption keys and uses the same recovery password as the local repository. Save the password from `~/.config/rendergallery-backup/recovery-password` in Dashlane, along with the bucket and endpoint, separately from the backup repository. After a total VPS loss, the cloud credentials and recovery password are both needed.

The installer takes a fresh local backup, copies all retained tagged snapshots, checks repository structure, and downloads/restores the latest cloud snapshot into a disposable directory. Manifest checks, SQLite integrity and referenced files must pass before timers are enabled. A failed setup leaves the service failure visible and does not claim cloud protection is active.

## Schedule and monitoring

| Job | Schedule |
| --- | --- |
| Fresh snapshot and cloud copy | Daily at 06:10 UTC |
| Cloud retention/prune and full authenticated data read | Sundays at 08:10 UTC |
| Full cloud restore drill | Second day of each month at 09:10 UTC |

Each job has up to five minutes of jitter. Jobs share the local backup lock and serialize with local snapshots/maintenance. The daily copy targets up to one day of loss if the entire VPS is lost. Retention is 24 hourly, 7 daily, 4 weekly and 6 monthly overlapping restore points. The initial copy may take longer; subsequent copies skip already copied snapshots. Full reads and restores use cloud bandwidth/API requests; review provider billing and disk growth. No paid service is provisioned automatically.

```sh
systemctl list-timers 'rendergallery-cloud-*'
sudo journalctl -u rendergallery-cloud-copy -n 50 --no-pager
sudo cat /srv/rendergallery-backups/last-success-cloud-copy
sudo systemctl start rendergallery-cloud-restore-check.service
systemctl --failed
```

Email/push failure alerts are not configured. The success timestamp and failed service status need monitoring. These credentials permit pruning/deletion within this bucket, so this is an off-server recovery layer, not immutable protection against a compromised root account. Keep B2 account access independent of the VPS.

## Recover without the VPS

On a clean trusted recovery machine, install restic and securely supply the application key ID/secret as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, the repository as `RESTIC_REPOSITORY=s3:https://S3_ENDPOINT/BUCKET/rendergallery`, and a private recovery-password file as `RESTIC_PASSWORD_FILE`. Do not put literal secrets in shell history.

Run `restic check --read-data`, then `restic restore latest --tag rendergallery --target /private/recovery`. Verify the recovered `/private/recovery/srv/rendergallery-backups/stage` with `backup-snapshot.py verify`, and follow the [disaster recovery steps](backups.md#restore-drill-and-disaster-recovery). Cloud credentials are deliberately excluded from the snapshot; retrieve them from your password manager or issue a new restricted key through your B2 account.
