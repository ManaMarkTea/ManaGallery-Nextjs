#!/usr/bin/env bash
# First deployment only. Run after building and testing rendergallery-stage/app.
set -euo pipefail
test "$(id -u)" -eq 0 || { echo 'Run with sudo bash.'; exit 1; }
stage=${1:?Usage: sudo bash setup-vps.sh STAGING_DIRECTORY SITE_HOST}
site_host=${2:?Provide the site hostname}
[[ "$site_host" =~ ^[a-z0-9.-]+$ ]] || { echo "Invalid hostname"; exit 1; }
stage=$(realpath -e "$stage")
test -f "$stage/app/.next/BUILD_ID"
test -f "$stage/data/gallery.sqlite"
test ! -e /srv/rendergallery/app || { echo 'Existing installation found; refusing to overwrite it.'; exit 1; }
python3 - "$stage/data/gallery.sqlite" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    settings = dict(db.execute('SELECT key,value FROM site_settings'))
    assert settings.get('registrationOpen') == 'false', 'Test registration must be disabled'
    assert settings.get('adsenseEnabled') == 'false', 'Test ads must be disabled'
    assert db.execute('SELECT count(*) FROM sessions').fetchone()[0] == 0, 'Local sessions must not be deployed'
PY

apt-get update
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o /tmp/rendergallery-caddy.key
gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg /tmp/rendergallery-caddy.key
curl -1fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
chmod 644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

id rendergallery >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/rendergallery --create-home --shell /usr/sbin/nologin rendergallery
install -d -m 755 /opt/rendergallery-node /srv/rendergallery
cp -a "$stage/node/bin" "$stage/node/lib" "$stage/node/include" "$stage/node/share" /opt/rendergallery-node/
chown -R root:root /opt/rendergallery-node
chmod -R go+rX /opt/rendergallery-node
ln -s /opt/rendergallery-node/bin/node /usr/local/bin/node
ln -s /opt/rendergallery-node/bin/npm /usr/local/bin/npm
ln -s /opt/rendergallery-node/bin/npx /usr/local/bin/npx

cp -a "$stage/app" /srv/rendergallery/app
cp -a "$stage/data" /srv/rendergallery-data
chown -R root:rendergallery /srv/rendergallery/app
chmod -R g+rX,o-rwx /srv/rendergallery/app
chown -R rendergallery:rendergallery /srv/rendergallery-data
chmod -R go-rwx /srv/rendergallery-data
install -d -o rendergallery -g rendergallery -m 700 /srv/rendergallery/app/.next/cache
chown -R rendergallery:rendergallery /srv/rendergallery/app/.next/cache

install -m 600 /dev/null /etc/rendergallery.env
cat > /etc/rendergallery.env <<EOF
NODE_ENV=production
APP_ORIGIN=https://${site_host}
RENDERGALLERY_DATA_DIR=/srv/rendergallery-data
TRUST_PROXY_HEADERS=true
ADSENSE_ENABLED=false
EOF
cat > /etc/systemd/system/rendergallery.service <<'EOF'
[Unit]
Description=RenderGallery test site
After=network.target

[Service]
User=rendergallery
Group=rendergallery
WorkingDirectory=/srv/rendergallery/app
EnvironmentFile=/etc/rendergallery.env
Environment=PATH=/opt/rendergallery-node/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/opt/rendergallery-node/bin/node /srv/rendergallery/app/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/srv/rendergallery-data /srv/rendergallery/app/.next/cache

[Install]
WantedBy=multi-user.target
EOF

cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-rendergallery
cat > /etc/caddy/Caddyfile <<EOF
${site_host} {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Forwarded-For {remote_host}
    }
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemctl enable --now rendergallery
systemctl enable caddy
systemctl reload caddy
systemctl --no-pager --full status rendergallery
echo "System installation complete. Point DNS for ${site_host} to this server for public HTTPS."
