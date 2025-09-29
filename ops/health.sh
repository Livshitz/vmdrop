#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env ]]; then
        set -a
        source .env
        set +a
fi

if [[ -z "${DOMAIN:-}" ]]; then
        echo "Set DOMAIN in .env first" >&2
        exit 1
fi

curl -fsSL "https://$DOMAIN/healthz" | cat
