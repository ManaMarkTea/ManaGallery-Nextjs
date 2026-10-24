# ManaGallery - Next.js

Start with [the installation guide](../docs/getting-started.md). No migration or existing gallery is required.


A community gallery for Bryce, Blender, DAZ Studio, Vue, Terragen and other rendering tools. The interface preserves the original Bryce5 gallery as part of one shared collection, with software and category filters.

## Start locally

Requires Node.js 24 and npm. Python 3 is needed only for archive imports and administrative maintenance scripts.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. VS Code also includes an F5 launch configuration. Development and production use separate build directories to avoid interfering with each other.

A clean checkout starts with an empty gallery and a few default categories. **Artwork, imported metadata and accounts are not included in this repository.** Register an account, then grant your first administrator role from a trusted local terminal:

```sh
python scripts/promote-admin.py YOUR_USERNAME
```

## Features

- Account registration, password sign-in, password changes and passkeys.
- JPEG, PNG and WebP uploads, decoded and converted to WebP, limited to 10 MB and 40 megapixels.
- New members submit uploads for approval. Administrators publish them, and can toggle future auto approval beside each uploader on the review page.
- Owners can edit titles, descriptions, categories, software and tags. Moderation decisions cannot be bypassed by editing.
- One shared gallery with software/category/search/sort filters and pagination. Imported artworks default to Bryce; owners/admins can correct classifications.
- Full-tab image viewing with Escape to close, comments, favorites and deletion controls.
- Modern administration for members, artwork, comments, categories, site settings and an activity log. Admin > Site health shows backup results and disk space; configurable gallery/member upload quotas preserve disk headroom.
- Member information includes local creation time, imported Bryce join/visit dates when available, last login/activity, successful login counts, login method, sessions, passkeys and contribution counts. Times are UTC. Login tracking starts with this version; past sign-ins are not reconstructed. Authenticated requests update last activity at most once per minute.
- The public Discord invite is preserved from the original community footer.
- Configurable AdSense in Admin > Settings, including publisher/slot validation, automatic ads.txt and a localhost preview guard. Configure real publisher IDs privately; examples contain placeholders. Ads appear only for signed-out gallery visitors. Domain approval and Google consent-message configuration are separate account setup steps.

## Private data

`storage/` holds SQLite account/session data, uploaded images, materials and other private runtime state. `public/data/`, `public/gallery/` and `public/full/` contain imported public artwork and metadata. All are excluded from Git, along with environment files, keys, dumps, deployment archives, test output and build output.

Keep public and private data backed up separately from the source repository. Stop the app before copying the whole storage directory, or use SQLite's backup API for a consistent database snapshot. Never copy only a live SQLite main file while ignoring its WAL journal. The packaging script creates a standalone snapshot and clears sessions, ads and registration only in its deployment copy.

The repository includes fictional test fixtures and a generated SVG placeholder. They contain no imported users, artwork or real credentials. A repository-content check rejects private data and common secret formats before publication.

## Configuration

Copy `.env.example` to `.env.local` as needed. Public hosting requires HTTPS and an exact `APP_ORIGIN`. Passkeys are bound to the domain, so credentials registered on localhost do not transfer to another host.

Set `RENDERGALLERY_DATA_DIR` to a persistent private directory. Set `TRUST_PROXY_HEADERS=true` only behind a reverse proxy that overwrites X-Forwarded-For. Otherwise authentication throttles share a local bucket. Address-based throttle keys are hashed and expire; view deduplication stores no IP addresses.

Admin-saved AdSense settings override optional environment defaults. Localhost and development builds never load live ads. Disabling advertising updates ads.txt as well.

## Test and build

```sh
npm run lint
npm run build
npx playwright install chromium
npm test
```

Tests use fictional gallery data and an isolated database on port 3100. They exercise auth/passkeys, permissions, uploads/approval, storage limits, views, pagination and advertising controls. Real device passkey prompts still need a manual check.

## Deploying

Use a persistent Node-capable server with Node 24, HTTPS and one app instance. Static/PHP-only hosting cannot run the app as written. Install dependencies and build on the target operating system; do not copy Windows node_modules to Linux.

`python scripts/package-vps.py` creates a private initial-deployment package under ignored storage/deployment. Transfer it over SSH, extract it into a private staging directory, install dependencies there and build using an isolated copy of the data. Node should be installed in the staging directory's node/bin for the provided scripts.

```sh
bash scripts/verify-vps-stage.sh /absolute/staging/directory test.example.com
sudo bash scripts/setup-vps.sh /absolute/staging/directory test.example.com
```

The first-deployment installer refuses to overwrite an existing app. It configures a separate rendergallery service account, root-owned code at /srv/rendergallery/app, private data at /srv/rendergallery-data, a systemd service, and Caddy HTTPS proxying to localhost:3000. Runtime settings live in /etc/rendergallery.env. DNS for the chosen host must point to the server. Domain/email records for other services need not change.

Use the [GitHub deployment command](docs/deployment.md) for future code updates while preserving the live database, uploads and materials. Back up live data before applying database migrations. Node is installed as a root-owned runtime under /opt/rendergallery-node; schedule runtime and system updates as part of server maintenance.

## Backups

See [backup setup and recovery](docs/backups.md) for encrypted hourly snapshots, retention, integrity checks, monthly restore drills, and off-server PC/cloud copies. The installer creates only the VPS layer; independent storage and recovery-password custody must also be configured.

## Remaining work before a wider public launch

Email verification/password recovery, legacy forums and new live ratings remain unfinished. See the [launch checklist](docs/launch-checklist.md) and [operations guide](docs/operations.md) for current status and limitations. The single-server SQLite/file layout needs persistent disk and independent backups. These controls and automated tests are not a comprehensive security audit. Imported static artwork URLs may remain accessible after moderation, while uploaded images and material downloads check permissions.
