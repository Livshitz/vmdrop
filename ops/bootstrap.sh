#!/usr/bin/env bash
set -euo pipefail

# One-command bootstrap: provision + initial deploy on a fresh droplet
# Required env in .env or exported:
#   DEPLOY_HOST, DEPLOY_USER (root for first run is ok), DOMAIN, EMAIL
# Optional: SSH_PASSWORD (uses sshpass), DEPLOY_PATH (/opt/digitalocean-scaffold), SERVICE_NAME (doscaffold)

if [[ -f .env ]]; then
        set -a; source .env; set +a
fi

DEPLOY_HOST=${DEPLOY_HOST:-}
DEPLOY_USER=${DEPLOY_USER:-root}
DEPLOY_PATH=${DEPLOY_PATH:-/opt/digitalocean-scaffold}
SERVICE_NAME=${SERVICE_NAME:-doscaffold}
SSH_PASSWORD=${SSH_PASSWORD:-}

if [[ -z "$DEPLOY_HOST" || -z "$DEPLOY_USER" ]]; then
        echo "ERROR: set DEPLOY_HOST and DEPLOY_USER/root" >&2
        exit 1
fi

if [[ -n "$SSH_PASSWORD" ]]; then
        if ! command -v sshpass >/dev/null 2>&1; then
                echo "ERROR: sshpass not installed locally" >&2
                exit 1
        fi
fi

if [[ -z "${DEPLOY_PATH// }" ]]; then
        echo "ERROR: DEPLOY_PATH is empty after evaluation" >&2
        exit 1
fi

echo "Ensuring remote path exists: $DEPLOY_PATH ..."
if [[ -n "$SSH_PASSWORD" ]]; then
        sshpass -p "$SSH_PASSWORD" ssh -o StrictHostKeyChecking=no "$DEPLOY_USER@$DEPLOY_HOST" "mkdir -p '$DEPLOY_PATH'"
else
        ssh "$DEPLOY_USER@$DEPLOY_HOST" "mkdir -p '$DEPLOY_PATH'"
fi

echo "Uploading project to $DEPLOY_HOST:$DEPLOY_PATH ..."
EXCLUDES=(--exclude ".git" --exclude "node_modules" --exclude ".github")
if [[ -n "$SSH_PASSWORD" ]]; then
        RSYNC_RSH="sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no"
        rsync -az --delete "${EXCLUDES[@]}" -e "$RSYNC_RSH" ./ "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/"
else
        rsync -az --delete "${EXCLUDES[@]}" -e ssh ./ "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/"
fi

REMOTE_CMD="cd '$DEPLOY_PATH' && bash ops/provision.sh && systemctl start ${SERVICE_NAME}.service && systemctl status ${SERVICE_NAME}.service | tail -n 20 | cat"

echo "Running remote provision and start..."
if [[ -n "$SSH_PASSWORD" ]]; then
        sshpass -p "$SSH_PASSWORD" ssh -o StrictHostKeyChecking=no "$DEPLOY_USER@$DEPLOY_HOST" "$REMOTE_CMD"
else
        ssh "$DEPLOY_USER@$DEPLOY_HOST" "$REMOTE_CMD"
fi

echo "Bootstrap complete. Visit https://$DOMAIN/healthz once DNS propagates."

