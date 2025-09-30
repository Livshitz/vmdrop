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
git clone <your repo> /opt/vmdrop
cd /opt/vmdrop

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
APP_DIR=/opt/vmdrop
APP_USER=app

# HTTPS
DOMAIN=example.com
EMAIL=you@example.com

# Deploy
DEPLOY_HOST=server.example.com
DEPLOY_USER=app
DEPLOY_PATH=/opt/vmdrop
# SSH_KEY used locally; CI injects SSH_PRIVATE_KEY secret
```

## VM Drop CLI (vmdrop)

This repo ships a CLI you can run from any Node.js/Bun project to deploy to a DigitalOcean droplet using a simple YAML config.

1) Create `vmdrop.yaml` in your project (see `vmdrop.example.yaml`).

```yaml
droplet:
  host: your.server.or.ip
  user: root
ssh:
  usePassword: true
  password: ${SSH_PASSWORD}  # Reads from .env or environment
app:
  name: your-service
  dir: /opt/your-service
  user: app
runtime:
  port: 3000
  env:
    MY_SECRET: ${MY_SECRET}  # Also supports env var substitution
https:
  domain: yourdomain.com
  email: you@domain.com
apt:
  packages:
    - ffmpeg
```

Create a `.env` file (add to `.gitignore`) with your secrets:
```bash
SSH_PASSWORD=your_root_password
MY_SECRET=secret_value
```

2) Build the CLI once in this repo:

```bash
bun run build
```

3) From any project folder containing `vmdrop.yaml`, run one of:

```bash
# Bootstrap: provision + deploy + start service
vmdrop bootstrap

# Provision only
vmdrop provision

# Deploy only (rsync + restart)
vmdrop deploy

# Tail logs from remote service
vmdrop logs
vmdrop logs --lines 500

# Open interactive SSH session
vmdrop ssh

# Use a non-default config path
vmdrop bootstrap --config ./path/to/other.yaml
```

The CLI reads `vmdrop.yaml` in the current directory by default. It supports password auth via `sshpass` or SSH key via `ssh.privateKey`.

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

