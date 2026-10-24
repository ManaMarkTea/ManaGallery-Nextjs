#!/usr/bin/env bash
# Run as the SSH administrator, never as root. Build without live data/secrets.
set -euo pipefail
umask 077
test "$(id -u)" -ne 0 || { echo 'Run as the SSH administrator, without sudo.'; exit 1; }
repo=${1:?Usage: bash pull-vps.sh OWNER/REPOSITORY SITE_HOST}
host=${2:?Provide the site hostname}
mode=${3:-deploy}
[[ "$mode" = deploy || "$mode" = --prepare-only ]]
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]
[[ "$host" =~ ^[a-z0-9.-]+$ ]]
base="$HOME/rendergallery-git"
stage="$HOME/rendergallery-git-stage"
seed="$HOME/rendergallery-stage"
export PATH=/opt/rendergallery-node/bin:/usr/local/bin:/usr/bin:/bin
mkdir -p "$base"
cd "$base"
exec 9>"$base/deploy.lock"
flock -n 9 || { echo 'Another deployment is running.'; exit 1; }
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/rendergallery-github -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
if [ ! -d "$base/source.git" ]; then
    git clone --bare "git@github.com:$repo.git" "$base/source.git"
fi
test "$(git --git-dir="$base/source.git" remote get-url origin)" = "git@github.com:$repo.git"
git --git-dir="$base/source.git" fetch --prune origin '+refs/heads/main:refs/heads/main'
commit=$(git --git-dir="$base/source.git" rev-parse refs/heads/main)
# New builds and one retained live release need headroom for dependencies/assets.
available=$(df --output=avail -B1 /srv | tail -1)
test "$available" -gt 8589934592 || { echo 'Less than 8 GiB free. Inspect old releases/backups before deploying.'; exit 1; }
if [ -e "$stage" ]; then
    test -f "$stage/.git-deploy-stage" || { echo 'Unrecognized staging directory; refusing cleanup.'; exit 1; }
    # Retain only dependency/build caches, never the previous build outputs.
    mkdir -p "$base/cache"
    if [ -d "$stage/app/node_modules" ]; then
        rm -rf -- "$base/cache/node_modules"
        mv "$stage/app/node_modules" "$base/cache/node_modules"
    fi
    if [ -d "$stage/app/.next/cache" ]; then
        rm -rf -- "$base/cache/next"
        mv "$stage/app/.next/cache" "$base/cache/next"
    fi
    rm -rf -- "$stage"
fi
mkdir -p "$stage/app" "$stage/data"
touch "$stage/.git-deploy-stage"
# The monorepo keeps independent build inputs under nextjs/. Older commits
# remain deployable from their original root layout.
source_tree="$commit"
if git --git-dir="$base/source.git" cat-file -e "$commit:nextjs/package.json" 2>/dev/null; then
    source_tree="$commit:nextjs"
fi
git --git-dir="$base/source.git" archive "$source_tree" | tar -x -C "$stage/app"
# Immutable imported archive stays outside Git; hard links save staging space.
for directory in data gallery full; do
    if [ -d "$seed/app/public/$directory" ]; then
        cp -al "$seed/app/public/$directory" "$stage/app/public/$directory"
    fi
done
cp "$seed/data/gallery.sqlite" "$stage/data/gallery.sqlite"
if [ -d "$seed/data/models" ]; then cp -a "$seed/data/models" "$stage/data/models"; fi
if [ -f "$seed/data/model-previews/catalogue.json" ]; then
    test -d "$stage/data/models" || { echo 'Model previews require the original model catalogue.'; exit 1; }
    for file in "$seed/data/model-previews/"*.glb; do
        if [ -f "$file" ]; then cp -- "$file" "$stage/data/models/"; fi
    done
    cp -- "$seed/data/model-previews/catalogue.json" "$stage/data/models/previews.json"
fi
export PATH=/opt/rendergallery-node/bin:/usr/local/bin:/usr/bin:/bin
export RENDERGALLERY_DATA_DIR="$stage/data" APP_ORIGIN="https://$host" ADSENSE_ENABLED=false NEXT_TELEMETRY_DISABLED=1
cd "$stage/app"
fingerprint=$({ sha256sum package.json package-lock.json; node --version; npm --version; uname -sm; } | sha256sum | cut -d' ' -f1)
if [ -d "$base/cache/node_modules" ] && [ "$(cat "$base/cache/dependencies.key" 2>/dev/null || true)" = "$fingerprint" ]; then
    echo 'Reusing dependencies (package files and runtime unchanged).'
    mv "$base/cache/node_modules" node_modules
else
    # A failed/interrupted npm ci must never leave a matching success marker.
    rm -f -- "$base/cache/dependencies.key"
    npm ci --include=dev --prefer-offline
    mkdir -p "$base/cache"
    printf '%s\n' "$fingerprint" > "$base/cache/dependencies.key"
fi
if [ -d "$base/cache/next" ]; then
    mkdir -p .next
    mv "$base/cache/next" .next/cache
    echo 'Reusing Next.js build cache; rebuilding and checking the current source.'
fi
bash scripts/verify-vps-stage.sh "$stage" "$host"
printf '%s\n' "$commit" > "$stage/app/.deployed-commit"
if [ "$mode" = --prepare-only ]; then
    echo "Prepared and verified commit $commit; live service has not been changed."
    exit 0
fi
echo "Verified main commit $commit. Promoting code; live data and settings are preserved."
# This is the only privileged step. Never run npm or the build with sudo.
if [ -x /usr/local/sbin/rendergallery-promote ]; then
    sudo -n /usr/local/sbin/rendergallery-promote
else
    sudo bash "$stage/app/scripts/update-vps.sh" "$stage"
fi
