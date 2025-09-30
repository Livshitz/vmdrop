#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env ]]; then set -a; source .env; set +a; fi

CMD=${1:-status}
DEPLOY_HOST=${DEPLOY_HOST:-}
DEPLOY_USER=${DEPLOY_USER:-app}
DEPLOY_PATH=${DEPLOY_PATH:-/opt/digitalocean-scaffold}
SERVICE_NAME=${SERVICE_NAME:-doscaffold}
SSH_KEY=${SSH_KEY:-}
SSH_PASSWORD=${SSH_PASSWORD:-}

if [[ -z "$DEPLOY_HOST" ]]; then
        echo "ERROR: DEPLOY_HOST not set" >&2
        exit 1
fi

SSH_BASE=(ssh -o StrictHostKeyChecking=no)
if [[ -n "$SSH_KEY" ]]; then
        SSH_BASE+=( -i "$SSH_KEY" )
fi
if [[ -n "$SSH_PASSWORD" ]]; then
        if ! command -v sshpass >/dev/null 2>&1; then echo "need sshpass" >&2; exit 1; fi
        SSH_BASE=(sshpass -p "$SSH_PASSWORD" ssh -o StrictHostKeyChecking=no)
fi

case "$CMD" in
status)
        "${SSH_BASE[@]}" "$DEPLOY_USER@$DEPLOY_HOST" systemctl status "$SERVICE_NAME" | tail -n 50 | cat
        ;;
logs)
        "${SSH_BASE[@]}" "$DEPLOY_USER@$DEPLOY_HOST" journalctl -u "$SERVICE_NAME" -n 200 -f --no-pager | cat
        ;;
restart)
        "${SSH_BASE[@]}" "$DEPLOY_USER@$DEPLOY_HOST" sudo systemctl restart "$SERVICE_NAME" && echo "restarted"
        ;;
provision)
        if [[ "$DEPLOY_USER" != "root" ]]; then
                REMOTE_CMD="cd '$DEPLOY_PATH' && sudo bash ops/provision.sh"
        else
                REMOTE_CMD="cd '$DEPLOY_PATH' && bash ops/provision.sh"
        fi
        "${SSH_BASE[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$REMOTE_CMD"
        ;;
cmd)
        shift
        "${SSH_BASE[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$@"
        ;;
*)
        echo "Usage: $0 [status|logs|restart|provision|cmd]" >&2
        exit 1
        ;;
esac

