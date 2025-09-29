# DigitalOcean Bun TS Scaffold

Minimal always-on server scaffold for a DigitalOcean droplet using Bun + TypeScript.

## Features

- HTTP API (`/`, `/healthz`, `/api/time`, `POST /api/echo`)
- WebSocket at `/ws` (echo + broadcast)
- systemd unit to run the app
- Caddy as HTTPS reverse proxy with automatic TLS
- Provisioning and deploy scripts
- GitHub Actions workflow for CI/CD

## Getting started (local)

```bash
bun install
bun run dev
# http://localhost:3000/healthz
```

WebSocket test:

```js
const ws = new WebSocket('ws://localhost:3000/ws');
ws.onmessage = (e) => console.log('msg', e.data);
ws.onopen = () => ws.send(JSON.stringify({ type: 'echo', payload: 'hi' }));
```

## Provision droplet

1. Point your domain A/AAAA records to the droplet IP.
2. SSH to droplet as root and run:

```bash
git clone <your repo> /opt/digitalocean-scaffold
cd /opt/digitalocean-scaffold

# Create .env (see below for keys)
cp env.example .env  # or create manually

# Provision (reads .env automatically)
bash ops/provision.sh
```

## Deploy

Local deploy:

```bash
# With .env present (recommended)
bash ops/deploy.sh
```

CI/CD: set GitHub repo secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`, `SERVICE_NAME`, `SSH_PRIVATE_KEY`.

## systemd override

Edit `ops/systemd/doscaffold.service` if needed (env, path). After first deploy:

```bash
sudo systemctl enable doscaffold
sudo systemctl restart doscaffold
sudo journalctl -u doscaffold -f
```

## Caddy

Edit `ops/caddy/Caddyfile` with your domain/email. Provision script places it to `/etc/caddy/Caddyfile` and restarts Caddy.

## .env variables

Create `.env` in project root. Example keys:

```bash
# Runtime
HOST=0.0.0.0
PORT=3000
NODE_ENV=production

# Service
SERVICE_NAME=doscaffold
APP_DIR=/opt/digitalocean-scaffold
APP_USER=app

# HTTPS
DOMAIN=example.com
EMAIL=you@example.com

# Deploy
DEPLOY_HOST=server.example.com
DEPLOY_USER=app
DEPLOY_PATH=/opt/digitalocean-scaffold
# SSH_KEY used locally; CI injects SSH_PRIVATE_KEY secret
```

## One-command bootstrap (self-contained)

Provision + start on a fresh droplet in one step. Supports SSH key or password (via sshpass).

1) Create `.env` locally with at least:

```bash
DEPLOY_HOST=your.server.or.ip
DEPLOY_USER=root
DOMAIN=yourdomain.com
EMAIL=you@domain.com
```

2) If using password auth, also add:

```bash
SSH_PASSWORD=your_root_password
```

3) Run:

```bash
bash ops/bootstrap.sh
```

After DNS propagates, verify: `https://yourdomain.com/healthz`.
```

