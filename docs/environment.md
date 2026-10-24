# Recreating the server environment

For this single VPS, a versioned setup script is enough. Terraform would create
provider resources such as machines or DNS; it would not replace restoring the
application database, artwork and independently stored credentials. The setup
below configures an existing **Ubuntu 24.04 x86_64** machine with systemd.

## What the script does

`scripts/setup-environment.py` previews its plan by default. With `--apply`, it
installs base packages, the official Caddy apt repository, and the pinned Node 24
runtime after checking its SHA256. npm dependencies are built from the repository
lockfile as the SSH administrator, never root. It installs the app service,
private data directories, reverse proxy, scoped passwordless deploy helper, and
optionally UFW/local/B2 backup jobs. Phase messages show its progress.

It is safe to rerun for the same domain: existing live data/code, environment
values, recovery password, SSH configuration, other Caddy sites and backup
repositories are preserved. Managed config files are backed up before changes;
unchanged files are not rewritten. It refuses a different live domain, an
unexpected installed Node version, and unrecognized nonempty data roots.
Updating existing application code remains the separate pull/deploy command.

This is functional reproducibility, not a frozen OS image: Node and npm
dependencies are pinned; Ubuntu/Caddy packages receive the versions available
from their configured signed repositories. Update the Node version **and** its
official archive SHA together when scheduling a runtime upgrade.

## Prepare a replacement machine

1. Install Ubuntu 24.04 through the host control panel. Establish key-based SSH
   access and sudo for your administrator account, and verify a second connection.
   The script deliberately does not replace SSH keys, disable authentication
   methods or reinstall the OS. Existing SSH access is the bootstrap prerequisite.
2. Clone this code repository somewhere readable by that administrator, normally
   under their home directory. Root installation trusts this checkout: review the
   source before running it with sudo.
3. Restore or generate the administrator's private read-only GitHub deploy key at
   `~/.ssh/rendergallery-github` and pin GitHub's host key in `~/.ssh/known_hosts`.
   The key needs access only to this repository. A regenerated public key must be
   added to GitHub's repository Deploy keys first; private keys never enter Git.
4. For recovery, restore the encrypted B2 snapshot into a **private, separate**
   recovery directory and verify it using [the B2 recovery instructions](backblaze.md).
   Do not restore straight over live directories. Record the resulting staging
   tree, normally `/private/recovery/srv/rendergallery-backups/stage`.
5. Recover the original restic password into root-only
   `/etc/rendergallery-backup.password` **before** reconnecting an existing cloud
   repository. Keep the original B2 application credentials separately as well.
   They are intentionally not stored in the encrypted application snapshot.

## One configuration, one command

Copy `deploy/environment.example.json` to `environment.local.json` and edit:

- `siteHost`, `adminUser`, and `repository` for this installation.
- `restoreSnapshot`: the absolute path of the verified restored staging tree, or
  `null` when reusing an existing private `~/rendergallery-stage/data` seed.
- `allowEmpty`: keep false for recovery. True explicitly permits a new empty
  gallery if neither restored data nor a seed exists. It does not erase existing
  data or create administrator accounts. Registration starts closed; use a
  trusted local account/bootstrap process before opening a fresh site.
- `manageFirewall`: true adds the SSH ports reported by sshd, HTTP and HTTPS,
  then enables UFW with incoming denied/outgoing allowed. Existing allow rules
  survive. Use false when the host has other firewall management or workloads.
- `localBackups` and `cloudBackups`: enable the desired layers. Cloud setup uses
  private interactive prompts when no B2 configuration exists. For an existing
  bucket, reuse the private `/etc/rendergallery-cloud.env` configuration and
  original recovery password; do not initialize another repository over it.

```sh
# Preview: can run locally or on the VPS; performs no installation/network calls.
python3 scripts/setup-environment.py environment.local.json

# Apply on the target VPS; initial downloads/build/backup drills take several minutes.
sudo python3 scripts/setup-environment.py environment.local.json --apply
```

The local config filename is ignored and rejected by the source-only repository
check. It contains deployment settings, not credential values. Never add secret
values or user data to the example config.

The script restores original account/data/settings into the service's private
directory only when no live database exists. It makes a **separate** build seed
with advertising/registration disabled. Active sessions, passkey challenges and
rate-limit state are cleared during recovery, so members sign in again. Existing
live data is untouched on repeat runs. Original domain-bound passkeys still need
the same HTTPS origin to work.

On first install it builds, promotes and checks the app using the same rollback
helper used by ordinary updates. On repeat runs it installs missing/configured
infrastructure without replacing live application code. Backups perform their
initial transfer and restore checks before enabling their timers.

## Verify and keep recovery independent

```sh
systemctl is-active rendergallery caddy
systemctl list-timers 'rendergallery-*'
systemctl --failed
sudo ufw status
```

Point the selected domain at the replacement server, verify public HTTPS, and
test sign-in, an existing artwork, a model/material download and upload approval.
The script's loopback HTTP check does not prove DNS or a public certificate is
ready. DNS/mail changes and creating a B2 account/bucket remain external actions.

Save the edited config, the chosen source commit and recovery credentials in
independent protected storage. GitHub has code; B2 has encrypted content;
Dashlane holds the keys needed to recover it. Provider weekly DR backups remain
an additional layer. Backups are not a substitute for rehearsing a replacement
host restore.
