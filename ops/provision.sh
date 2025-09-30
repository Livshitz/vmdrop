#!/usr/bin/env bash
set -euo pipefail

# Usage: DOMAIN=example.com EMAIL=you@example.com bash ops/provision.sh
# .env in repo root is read automatically if present

# Load env from .env if present
if [[ -f .env ]]; then
        set -a
        # shellcheck disable=SC1091
        source .env
        set +a
fi

DOMAIN=${DOMAIN:-}
EMAIL=${EMAIL:-}
SERVICE_NAME=${SERVICE_NAME:-doscaffold}
APP_DIR=${APP_DIR:-/opt/vmdrop}
APP_USER=${APP_USER:-app}

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
        echo "ERROR: set DOMAIN and EMAIL env vars" >&2
        exit 1
fi

export DEBIAN_FRONTEND=noninteractive

# Wait for any other apt/dpkg operations (e.g., cloud-init) to finish
wait_for_apt() {
        while pgrep -x apt >/dev/null 2>&1 || pgrep -x apt-get >/dev/null 2>&1 || pgrep -x dpkg >/dev/null 2>&1; do
                echo "Waiting for apt lock..." >&2
                sleep 5
        done
}

wait_for_apt
apt-get update -y
wait_for_apt
apt-get upgrade -y
wait_for_apt
apt-get install -y curl ca-certificates rsync ufw caddy unzip ffmpeg

# Create app user if missing
if ! id -u "$APP_USER" >/dev/null 2>&1; then
        useradd -m -s /bin/bash "$APP_USER"
fi

mkdir -p "$APP_DIR"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# Install Bun
if ! command -v bun >/dev/null 2>&1; then
        curl -fsSL https://bun.sh/install | bash
fi
# Ensure bun binary is installed system-wide and executable by non-root users
if [[ -f "/root/.bun/bin/bun" ]]; then
        install -m 0755 "/root/.bun/bin/bun" /usr/local/bin/bun
fi

"${SUDO:-sudo}" install -m 0644 ops/systemd/doscaffold.service /etc/systemd/system/${SERVICE_NAME}.service
"${SUDO:-sudo}" sed -i "s|/opt/vmdrop|${APP_DIR}|g" /etc/systemd/system/${SERVICE_NAME}.service
"${SUDO:-sudo}" sed -i "s|^User=app|User=${APP_USER}|" /etc/systemd/system/${SERVICE_NAME}.service

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}.service || true

# Configure Caddy
mkdir -p /etc/caddy
sed -e "s/YOUR_DOMAIN.com/${DOMAIN}/g" -e "s/YOUR_EMAIL@example.com/${EMAIL}/g" ops/caddy/Caddyfile > /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

# UFW basic hardening
ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw allow 8085/tcp || true
ufw --force enable || true

echo "Provisioning complete. Point DNS for ${DOMAIN} to this droplet's IP."

