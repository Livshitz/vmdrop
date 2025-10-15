## VM Drop (vmdrop)

Simple CLI to deploy any Node.js or Bun project to any Linux VM. It provisions the machine (Bun, Caddy, firewall, systemd), uploads your app via rsync, writes env vars, and keeps your service running under systemd with optional HTTPS via Caddy.

## Why vmdrop

- Minimal, zero-frills VM deploys using your own server
- One config file, one command
- Works with password or SSH key auth
- First-class Bun support, Node.js compatible
- **Multi-distro support:** Ubuntu/Debian, Amazon Linux, Rocky Linux, AlmaLinux, CentOS, Alpine, and more
- Auto-detects package manager (apt, dnf, yum, apk)

## Requirements

Local (your laptop):
- Bun in PATH (`bun --version`)
- `ssh` and `rsync`
- `sshpass` if using password auth (macOS: `brew install hudochenkov/sshpass/sshpass`)

Remote (your VM):
- Any modern Linux distribution (Ubuntu, Debian, Amazon Linux 2023, Rocky Linux, AlmaLinux, CentOS, Alpine, etc.)
- Root or a sudo-capable user for initial provisioning
- systemd for service management

## Run (no install)

Prefer running via bunx/npx directly in your project:

```bash
# Using Bun (recommended)
bunx vmdrop bootstrap

# Using Node/npm
npx vmdrop bootstrap
```

Optional global install (not required):

```bash
npm i -g vmdrop      # or: bun add -g vmdrop
```

From this repo (dev mode):

```bash
bun run build
# then run from this repo directory
bun run src/cli/index.ts bootstrap --config ./vmdrop.example.yaml
```

## Quickstart: deploy your project

**Need help?** Run `bunx vmdrop --help` to see all commands and options.

1) In your app repo, create `vmdrop.yaml` (see the reference below). Minimal example:

```yaml
droplet:
  host: your.server.or.ip
  user: root
app:
  name: myapp
  dir: /opt/myapp
  user: app
runtime:
  port: 3000
service:
  name: myapp
  # For Node apps, set your start command (systemd ExecStart):
  execStart: /usr/bin/node dist/server.js
https:
  domain: yourdomain.com
  email: you@domain.com
```

2) Optional: create a local `.env` alongside `vmdrop.yaml` to provide secrets or passwords used in the config (the CLI reads it automatically):

```bash
SSH_PASSWORD=your_root_password
MY_SECRET=value
```

You can reference env values in `vmdrop.yaml` with `${VAR}`:

```yaml
ssh:
  usePassword: true
  password: ${SSH_PASSWORD}
runtime:
  env:
    MY_SECRET: ${MY_SECRET}
```

3) Run bootstrap (provision + deploy + start):

```bash
bunx vmdrop bootstrap
# or: npx vmdrop bootstrap
```

After DNS propagates, verify your app: `https://yourdomain.com/healthz` (or your app’s path).

## Commands

Use with `bunx vmdrop ...` (or `npx vmdrop ...`):

- `bunx vmdrop bootstrap` — Provision the VM, upload the project, write `.env`, install deps, start/restart systemd service.
- `bunx vmdrop provision` — Provision only (Bun, Caddy, firewall, systemd unit). Does not deploy code.
- `bunx vmdrop deploy` — Rsync project, update remote `.env`, install deps, restart service, reload Caddy.
- `bunx vmdrop logs [--lines N]` — Tail service logs from `journalctl`.
- `bunx vmdrop ssh` — Open an interactive SSH session to the VM.

Global flags:
- `--help`, `-h`, `-?` — Show help message with usage information
- `--config <path>` — Use a non-default config path (default: `vmdrop.yaml` or `vmdrop.yml`)
- `--verbose` or `-v` — Enable verbose logging to see detailed progress information
- `--lines <N>` — Number of log lines to show (for `logs` command, default: 200)

### Verbose Mode

For troubleshooting or to see exactly what vmdrop is doing, use the `--verbose` or `-v` flag:

```bash
bunx vmdrop deploy --verbose
# or
bunx vmdrop bootstrap -v
```

Verbose mode shows:
- Local dependency checks
- SSH connection details
- File sync operations with exclusions
- Environment variable counts
- Service existence checks
- Package installation progress
- All commands being executed

Example output:
```
🔍 Verbose mode enabled
[verbose] Command: deploy
[verbose] Config path: auto-detect
[verbose] Loaded config for myapp
[verbose] Target: root@203.0.113.10
[verbose] Checking local dependencies...
[verbose] ✓ Found ssh
[verbose] ✓ Found rsync
📦 Uploading project files...
[verbose] Syncing to root@203.0.113.10:/opt/myapp/
[verbose] Excluding: .git, node_modules, .github, bun.lockb
...
```

## Deployment Flow

### `vmdrop bootstrap` (first-time deployment)
1. **Connect** - Establish SSH connection to the VM
2. **Detect** - Auto-detect package manager (apt/dnf/yum/apk)
3. **Provision** - Install system packages, Bun, Caddy, configure firewall (UFW or firewalld)
4. **Upload** - Rsync project files to `app.dir`
5. **Configure** - Create/update remote `.env` file from `runtime.env`
6. **Service** - Create systemd unit file and enable service
7. **Start** - Install dependencies (if package.json exists), start service
8. **HTTPS** - Caddy automatically requests SSL certificate (if `https:` configured)

### `vmdrop deploy` (subsequent updates)
1. **Upload** - Rsync changed files to remote
2. **Configure** - Update remote `.env` (merges with existing values)
3. **Restart** - Install dependencies, restart systemd service
4. **Reload** - Reload Caddy if Caddyfile changed

### `vmdrop provision` (infrastructure only)
1. **System** - Install packages, Bun, Caddy, firewall
2. **Service** - Create systemd unit file
3. **Firewall** - Configure firewall rules
4. _(Does not deploy code or start service)_

### Use from package.json scripts

Add convenient scripts in your app:

```json
{
  "scripts": {
    "deploy:bootstrap": "bunx vmdrop bootstrap",
    "deploy:provision": "bunx vmdrop provision",
    "deploy": "bunx vmdrop deploy",
    "deploy:logs": "bunx vmdrop logs --lines 300",
    "deploy:ssh": "bunx vmdrop ssh"
  }
}
```

Then run e.g.: `npm run deploy` or `bun run deploy`.

## Config reference (`vmdrop.yaml`)

```yaml
droplet:
  host: 203.0.113.10
  user: root                # or a sudo-capable user

ssh:
  usePassword: false        # true enables sshpass
  password: ${SSH_PASSWORD} # optional, when usePassword: true
  privateKey: ~/.ssh/id_ed25519

app:
  name: myapp
  dir: /opt/myapp
  user: app

runtime:
  host: 127.0.0.1           # binds your app behind Caddy
  port: 3000
  nodeEnv: production
  env:                       # merged into remote .env; config wins on conflicts
    MY_SECRET: ${MY_SECRET}

service:
  name: myapp
  # Default runs Bun TS entry: 
  #   /usr/local/bin/bun run src/server.ts
  # For Node apps, set a Node start command:
  execStart: /usr/bin/node dist/server.js
  # Systemd service options (optional, with defaults shown):
  restart: always           # no, always, on-success, on-failure, on-abnormal, on-abort, on-watchdog
  restartSec: 2             # seconds to wait before restart
  environmentFile: /opt/myapp/.env  # defaults to ${app.dir}/.env
  killSignal: SIGINT        # signal to send on stop

https:                       # optional; omit to expose plain HTTP on :80 through Caddy
  domain: example.com
  email: you@example.com

deploy:
  path: /opt/myapp          # defaults to app.dir
  excludes:                 # defaults: .git, node_modules, .github, bun.lockb
    - .git
    - node_modules

# Package management (OS-agnostic, auto-detects apt/dnf/yum/apk)
packages:
  manager: auto             # auto (default), apt, dnf, yum, or apk
  list:
    - ffmpeg                # extra packages to install during provision

# Backward compatible (deprecated, use 'packages:' instead)
apt:
  packages:
    - ffmpeg
```

Notes:
- **Multi-distro support**: vmdrop auto-detects your package manager (apt, dnf, yum, apk) and works on Ubuntu, Debian, Amazon Linux, Rocky Linux, AlmaLinux, CentOS, Alpine, and more.
- On provision, the CLI installs base packages (curl, ca-certificates, rsync, unzip) plus your extras, Bun, Caddy, configures firewall (UFW or firewalld), sets up systemd, and writes `/etc/caddy/Caddyfile`.
- Remote `.env` is merged: existing values are preserved unless overridden by `runtime.env`.
- Caddy Caddyfile is auto-generated from `https.domain` config and set up as a reverse proxy to your app.
- Strict host key checking is disabled during automation for convenience.

## CI/CD

Use bunx/npx in CI. Set repository secrets and call the CLI from a workflow.

Recommended secrets:
- `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`, `SERVICE_NAME`, `SSH_PRIVATE_KEY`

Example GitHub Actions job:

```yaml
name: Deploy
on:
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - name: Deploy
        env:
          DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
          DEPLOY_USER: ${{ secrets.DEPLOY_USER }}
          DEPLOY_PATH: ${{ secrets.DEPLOY_PATH }}
          SERVICE_NAME: ${{ secrets.SERVICE_NAME }}
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_PRIVATE_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          bunx vmdrop deploy
```

## Using the included example server (optional)

This repo includes a minimal Bun + TypeScript server you can run locally:

```bash
bun install
bun run dev
# http://localhost:3000/healthz
```

WebSocket quick test:

```js
const ws = new WebSocket('ws://localhost:3000/ws');
ws.onmessage = (e) => console.log('msg', e.data);
ws.onopen = () => ws.send(JSON.stringify({ type: 'echo', payload: 'hi' }));
```

## Troubleshooting

- sshpass not found: install it locally (macOS: `brew install hudochenkov/sshpass/sshpass`).
- Permission denied (publickey/password): verify SSH credentials in `vmdrop.yaml` and/or `.env`.
- Caddy TLS fails: ensure your domain’s A/AAAA records point to the droplet’s IP and retry.
