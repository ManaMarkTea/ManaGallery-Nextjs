# Deploying from GitHub

For a fresh or replacement machine, use the [repeatable environment setup](environment.md)
before ordinary code deployments.

Work locally, commit and push to the private repository. GitHub runs the code checks.
After the checks are green, run this from PowerShell in the repository:

```powershell
./scripts/deploy.ps1 -Server USER@SERVER_IP -SiteHost test.example.com -Repository OWNER/REPOSITORY
```

This pushes main, uploads a small bootstrap helper, and asks the VPS to fetch main
directly from GitHub using its read-only repository deploy key. The helper prints
the exact commit being deployed. It builds and smoke-tests in an isolated staging
directory as the SSH user. Only promotion asks for your server sudo password.
There is no password or private key in GitHub and no unattended root SSH access.
This is a manual deployment; pushing alone does not change the running site.

## Remove repeated sudo password prompts

Run `sudo bash scripts/setup-passwordless-deploy.sh YOUR_SSH_ADMIN_USERNAME`
once on the VPS from a directory containing that installer and `promote-vps.py`.
It installs a root-owned fixed-site promotion helper and a sudoers rule allowing
only `/usr/local/sbin/rendergallery-promote` with **no arguments**. Subsequent
`deploy.ps1` / `pull-vps.sh` runs use it without asking for a password. General
sudo commands still require authentication. Root-owned config fixes the staging
directory and SSH user; callers cannot choose another service or destination.

Builds and archive packing run as the SSH user. The helper rejects archive links,
path traversal, special files and oversized payloads, and controls destination
ownership itself. npm links are flattened before crossing the privilege boundary.
Database migrations and repository Python code execute as the app service user,
never root. The helper may only replace this app, import its private data and
restart its service. Backup programs, the helper itself, systemd units and other
root infrastructure still need an explicit sudo installation when changed.

Promotion prints phase messages and copy progress every ten seconds while data
arrives. Expected connection retries during Next.js startup are quiet. The
passwordless path uses the same database backup, health check and code rollback
policy as the original manual updater. It does not expose a web update endpoint.

The existing initial `~/rendergallery-stage` supplies the imported archive and
isolated build database. Keep that directory until a replacement archive source
has been configured. Its data is never copied over the live database by updates.
`/srv/rendergallery-data` and `/etc/rendergallery.env` remain on the server, so
accounts, uploaded images, moderation decisions and settings survive deployments.

The promotion script makes a consistent SQLite backup, retains the previous app,
restarts the service, and checks HTTP. A failed health check restores the previous
code. Additive database changes remain; destructive schema changes require a
separate migration and restore plan. See [backups.md](backups.md) for encrypted
backups and off-server recovery.

Updates require 8 GiB free before building. The pull script reuses dependencies
when package files and the Node/npm runtime match, and retains the Next.js build
cache. Each deployment still rebuilds, lints and smoke-tests the current source.

With the updated passwordless helper installed, ordinary updates reuse the
root-owned, immutable `public/gallery` and `public/full` archive through hard
links instead of copying all images. Uploaded artwork lives separately in the
data directory and is unaffected. Incoming archives still cannot contain links.
After a healthy promotion, the helper retains the two most recent previous code
releases and removes older timestamped successful releases. Failed releases and
database backups are retained for investigation/recovery; monitor their usage.

**Legacy archive refresh:** ordinary code deployments intentionally reuse the
existing imported image archive. After importing replacement/new legacy archive
files into the seed, temporarily set `reuseArchive` to `false` in the root-owned
`/etc/rendergallery-deploy.json` with `sudoedit`, deploy once, then restore `true`.
Initial installation automatically copies the archive when no existing archive
is available. Modern uploads do not require this procedure.

Install a changed promotion helper explicitly with
`sudo bash scripts/setup-passwordless-deploy.sh YOUR_SSH_ADMIN_USERNAME`.
Fetching Git cannot replace this privileged helper. Never delete the current app
or `/srv/rendergallery-data` when clearing disk space.

One-time server access: create `~/.ssh/rendergallery-github` with `ssh-keygen`, add
its public key to the repository's Deploy keys **without write access**, and pin
GitHub's host key in the SSH user's known_hosts using a trusted source. The current
test server is configured this way. The private key stays on that server.

Future automation can trigger this same flow after successful checks. It needs a
separately scoped deployment identity and restricted promotion permissions; do not
put your personal SSH private key or sudo password into Actions secrets.
