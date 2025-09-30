#!/usr/bin/env bash
set -euo pipefail

# Env vars required:
#   DEPLOY_HOST, DEPLOY_USER
# Optional:
#   DEPLOY_PATH (default /opt/vmdrop)
#   SERVICE_NAME (default doscaffold)
#   SSH_KEY (path to private key)

# Load env from .env if present
if [[ -f .env ]]; then
        set -a
        # shellcheck disable=SC1091
        source .env
        set +a
fi

DEPLOY_HOST=${DEPLOY_HOST:-}
DEPLOY_USER=${DEPLOY_USER:-}
DEPLOY_PATH=${DEPLOY_PATH:-/opt/vmdrop}
SERVICE_NAME=${SERVICE_NAME:-doscaffold}
SSH_KEY_FLAG=${SSH_KEY:+-i "$SSH_KEY"}
USE_PASSWORD=${USE_PASSWORD:-}
SSH_PASSWORD=${SSH_PASSWORD:-}

if [[ -z "$DEPLOY_HOST" || -z "$DEPLOY_USER" ]]; then
        echo "ERROR: set DEPLOY_HOST and DEPLOY_USER" >&2
        exit 1
fi

RSYNC_EXCLUDES=(
        --exclude ".git"
        --exclude "node_modules"
        --exclude ".github"
        --exclude "bun.lockb"
)

echo "Syncing to $DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH ..."
if [[ -n "$SSH_PASSWORD" || -n "$USE_PASSWORD" ]]; then
        if ! command -v sshpass >/dev/null 2>&1; then
                echo "ERROR: sshpass not found. Install it (brew install hudochenkov/sshpass/sshpass on macOS)." >&2
                exit 1
        fi
        RSYNC_RSH="sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no"
        rsync -az --delete "${RSYNC_EXCLUDES[@]}" -e "$RSYNC_RSH" ./ "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/"
else
        rsync -az --delete "${RSYNC_EXCLUDES[@]}" -e "ssh $SSH_KEY_FLAG" ./ "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/"
fi

echo "Installing deps and restarting service ..."
REMOTE_CMD="sudo chown -R app:app '$DEPLOY_PATH' && cd '$DEPLOY_PATH' && if command -v bun >/dev/null 2>&1 && [ -f package.json ]; then bun install --production; fi && sudo systemctl daemon-reload && sudo systemctl restart ${SERVICE_NAME}.service && sudo systemctl reload caddy && sudo systemctl status ${SERVICE_NAME}.service | tail -n 20 | cat"

if [[ -n "$SSH_PASSWORD" || -n "$USE_PASSWORD" ]]; then
        sshpass -p "$SSH_PASSWORD" ssh -o StrictHostKeyChecking=no "$DEPLOY_USER@$DEPLOY_HOST" "$REMOTE_CMD"
else
        ssh $SSH_KEY_FLAG "$DEPLOY_USER@$DEPLOY_HOST" "$REMOTE_CMD"
fi

echo "Deploy done."

