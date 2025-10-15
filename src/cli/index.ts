#!/usr/bin/env bun
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse as parseYaml } from "yaml";
import { execa } from "execa";
import { z } from "zod";

// Types and schema
const ConfigSchema = z.object({
  droplet: z.object({
    host: z.string().min(1),
    user: z.string().min(1).default("root"),
  }),
  ssh: z
    .object({
      usePassword: z.boolean().default(false),
      password: z.string().optional(),
      privateKey: z.string().optional(),
    })
    .default({ usePassword: false }),
  app: z.object({
    name: z.string().default("doscaffold"),
    dir: z.string().default("/opt/vmdrop"),
    user: z.string().default("app"),
  }),
  runtime: z
    .object({
      host: z.string().default("127.0.0.1"),
      port: z.coerce.number().int().positive().default(3000),
      nodeEnv: z.string().default("production"),
      env: z
        .preprocess((val) => (val == null ? {} : val), z.record(z.string()))
        .default({}),
    })
    .default({ host: "127.0.0.1", port: 3000, nodeEnv: "production", env: {} }),
  service: z
    .object({
      name: z.string().default("doscaffold"),
      execStart: z
        .string()
        .default("/usr/local/bin/bun run src/server.ts"),
      restart: z.enum(["no", "always", "on-success", "on-failure", "on-abnormal", "on-abort", "on-watchdog"]).default("always"),
      restartSec: z.coerce.number().int().positive().default(2),
      environmentFile: z.string().optional(), // if not set, defaults to ${app.dir}/.env
      killSignal: z.string().default("SIGINT"),
    })
    .default({ 
      name: "doscaffold", 
      execStart: "/usr/local/bin/bun run src/server.ts",
      restart: "always",
      restartSec: 2,
      killSignal: "SIGINT"
    }),
  https: z
    .object({
      domain: z.string().min(1),
      email: z.string().min(3),
    })
    .optional(),
  deploy: z
    .object({
      path: z.string().optional(),
      excludes: z.array(z.string()).default([".git", "node_modules", ".github", "bun.lockb"]).optional(),
    })
    .default({}),
  packages: z
    .object({
      manager: z.enum(["auto", "apt", "dnf", "yum", "apk"]).default("auto"),
      list: z.array(z.string()).default([]),
    })
    .default({ manager: "auto", list: [] }),
  // Backward compatibility
  apt: z
    .object({
      packages: z.array(z.string()).default([]),
    })
    .optional(),
});

type Config = z.infer<typeof ConfigSchema>;

function findConfigPath(): string {
  const candidates = [
    "vmdrop.yaml",
    "vmdrop.yml",
    // Backward-compatible fallbacks
    "vmdrop.yml",
    "vmdrop.yaml",
    "doscaffold.yml",
    "doscaffold.yaml",
  ];
  for (const name of candidates) {
    const p = resolve(process.cwd(), name);
    if (existsSync(p)) return p;
  }
  throw new Error(
    `Config file not found. Create vmdrop.yaml in your project root or pass --config <path>.`
  );
}

function expandEnvVars(obj: any): any {
  if (typeof obj === "string") {
    // Replace ${VAR_NAME} or $VAR_NAME with process.env value
    return obj.replace(/\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/g, (match, braced, unbraced) => {
      const varName = braced || unbraced;
      return process.env[varName] ?? match;
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvVars);
  }
  if (obj !== null && typeof obj === "object") {
    const result: any = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = expandEnvVars(v);
    }
    return result;
  }
  return obj;
}

function loadLocalDotEnv() {
  try {
    const envPath = resolve(process.cwd(), ".env");
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx);
          const value = trimmed.substring(eqIdx + 1).replace(/^["']|["']$/g, "");
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    }
  } catch {
    // ignore
  }
}

function readConfig(customPath?: string): Config {
  // Load local .env first so env vars are available for substitution
  loadLocalDotEnv();
  
  const path = customPath ? resolve(process.cwd(), customPath) : findConfigPath();
  const raw = readFileSync(path, "utf8");
  const parsed = parseYaml(raw);
  
  // Expand environment variables in the parsed config
  const expanded = expandEnvVars(parsed);
  
  const cfg = ConfigSchema.parse(expanded);
  
  // Backward compatibility: merge apt.packages into packages.list
  if (cfg.apt && cfg.apt.packages.length > 0) {
    cfg.packages.list = [...new Set([...cfg.packages.list, ...cfg.apt.packages])];
  }
  
  // default deploy.path to app.dir
  if (!cfg.deploy.path) {
    (cfg as any).deploy.path = cfg.app.dir;
  }
  return cfg;
}

function buildSshBase(cfg: Config): string[] {
  const base = ["-o", "StrictHostKeyChecking=no"]; 
  if (cfg.ssh.usePassword) {
    base.push("-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no");
  }
  if (cfg.ssh.privateKey) {
    base.push("-i", cfg.ssh.privateKey);
  }
  return base;
}

async function ensureLocalDeps(cfg: Config) {
  const checks = ["ssh", "rsync"];
  if (cfg.ssh.usePassword) checks.push("sshpass");
  for (const bin of checks) {
    try {
      await execa("bash", ["-lc", `command -v ${bin}`]);
    } catch {
      throw new Error(
        `${bin} not found locally. Install it and retry${
          bin === "sshpass" ? " (e.g., brew install hudochenkov/sshpass/sshpass)" : ""
        }.`
      );
    }
  }
}

function detectPackageManagerScript(): string {
  return `
detect_package_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "apt"
  elif command -v dnf >/dev/null 2>&1; then
    echo "dnf"
  elif command -v yum >/dev/null 2>&1; then
    echo "yum"
  elif command -v apk >/dev/null 2>&1; then
    echo "apk"
  else
    echo "❌ Error: No supported package manager found (apt/dnf/yum/apk)" >&2
    echo "Detected OS: \$(uname -a)" >&2
    exit 1
  fi
}
`;
}

function buildProvisionScript(cfg: Config): string {
  const needsHttps = !!cfg.https;
  const domain = cfg.https?.domain ?? "example.invalid";
  const email = cfg.https?.email ?? "admin@example.invalid";
  const runtimeEnvLines: string[] = [
    `Environment=HOST=${cfg.runtime.host}`,
    `Environment=PORT=${cfg.runtime.port}`,
    `Environment=NODE_ENV=${cfg.runtime.nodeEnv}`,
  ];
  for (const [k, v] of Object.entries(cfg.runtime.env || {})) {
    runtimeEnvLines.push(`Environment=${k}=${v}`);
  }

  // Get packages from new 'packages' section or fallback to old 'apt' section
  const userPackages = cfg.packages.list.length > 0 ? cfg.packages.list : (cfg.apt?.packages ?? []);
  const defaultPackages = [
    "curl",
    "ca-certificates",
    "rsync",
    "ufw",
    "unzip",
  ];
  const allPackages = Array.from(new Set([...defaultPackages, ...userPackages]));

  const sudo = cfg.droplet.user === "root" ? "" : "sudo ";

  const caddyBlock = needsHttps
    ? `\n{\n        email ${email}\n}\n\n${domain} {\n        encode zstd gzip\n        reverse_proxy 127.0.0.1:${cfg.runtime.port}\n}\n\n`
    : `:80 {\n        encode zstd gzip\n        reverse_proxy 127.0.0.1:${cfg.runtime.port}\n}\n\n`;

  const envFile = cfg.service.environmentFile ?? `${cfg.app.dir}/.env`;
  const systemdUnit = `\n[Unit]\nDescription=${cfg.app.name} Service\nAfter=network.target\n\n[Service]\nUser=${cfg.app.user}\nWorkingDirectory=${cfg.app.dir}\n${runtimeEnvLines.join("\n")}\nEnvironmentFile=${envFile}\nExecStart=${cfg.service.execStart}\nRestart=${cfg.service.restart}\nRestartSec=${cfg.service.restartSec}\nKillSignal=${cfg.service.killSignal}\n\n[Install]\nWantedBy=multi-user.target\n`;

  return `set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

${detectPackageManagerScript()}

PKG_MGR=$(detect_package_manager)
echo "✓ Detected package manager: \$PKG_MGR"

wait_for_lock() {
  if [ "\$PKG_MGR" = "apt" ]; then
    while pgrep -x apt >/dev/null 2>&1 || pgrep -x apt-get >/dev/null 2>&1 || pgrep -x dpkg >/dev/null 2>&1; do
      echo "Waiting for package manager lock..." >&2
      sleep 5
    done
  fi
}

install_packages() {
  wait_for_lock
  case "\$PKG_MGR" in
    apt)
      ${sudo}apt-get update -y
      wait_for_lock
      ${sudo}apt-get upgrade -y
      wait_for_lock
      ${sudo}apt-get install -y "$@"
      ;;
    dnf)
      ${sudo}dnf check-update -y || true
      ${sudo}dnf upgrade -y
      ${sudo}dnf install -y "$@"
      ;;
    yum)
      ${sudo}yum check-update -y || true
      ${sudo}yum upgrade -y
      ${sudo}yum install -y "$@"
      ;;
    apk)
      ${sudo}apk update
      ${sudo}apk upgrade
      ${sudo}apk add "$@"
      ;;
  esac
}

# Install base packages
install_packages ${allPackages.join(" ")}

# Install Caddy (distro-specific)
echo "Installing Caddy..."
if ! command -v caddy >/dev/null 2>&1; then
  case "\$PKG_MGR" in
    apt)
      ${sudo}apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | ${sudo}gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | ${sudo}tee /etc/apt/sources.list.d/caddy-stable.list
      wait_for_lock
      ${sudo}apt-get update -y
      wait_for_lock
      ${sudo}apt-get install -y caddy
      ;;
    dnf|yum)
      ${sudo}\$PKG_MGR install -y 'dnf-command(copr)' 2>/dev/null || true
      ${sudo}\$PKG_MGR copr enable @caddy/caddy -y 2>/dev/null || true
      ${sudo}\$PKG_MGR install -y caddy 2>/dev/null || {
        echo "Installing Caddy from binary..."
        curl -o /tmp/caddy.tar.gz -L "https://caddyserver.com/api/download?os=linux&arch=amd64"
        ${sudo}tar -xzf /tmp/caddy.tar.gz -C /usr/local/bin caddy
        ${sudo}chmod +x /usr/local/bin/caddy
        rm /tmp/caddy.tar.gz
      }
      ;;
    apk)
      ${sudo}apk add caddy 2>/dev/null || {
        echo "Installing Caddy from binary..."
        curl -o /tmp/caddy.tar.gz -L "https://caddyserver.com/api/download?os=linux&arch=amd64"
        ${sudo}tar -xzf /tmp/caddy.tar.gz -C /usr/local/bin caddy
        ${sudo}chmod +x /usr/local/bin/caddy
        rm /tmp/caddy.tar.gz
      }
      ;;
  esac
fi

# Create app user
if ! id -u "${cfg.app.user}" >/dev/null 2>&1; then
  ${sudo}useradd -m -s /bin/bash "${cfg.app.user}"
fi

${sudo}mkdir -p "${cfg.app.dir}"
${sudo}chown -R "${cfg.app.user}":"${cfg.app.user}" "${cfg.app.dir}"

# Install Bun
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
fi
if [[ -f "/root/.bun/bin/bun" ]]; then
  ${sudo}install -m 0755 "/root/.bun/bin/bun" /usr/local/bin/bun || true
fi

# Install systemd unit
${sudo}bash -lc 'cat > /etc/systemd/system/${cfg.service.name}.service <<\UNIT\n${systemdUnit}UNIT'
${sudo}systemctl daemon-reload
${sudo}systemctl enable ${cfg.service.name}.service || true

# Caddy config
${sudo}mkdir -p /etc/caddy
${sudo}bash -lc 'cat > /etc/caddy/Caddyfile <<\CADDY\n${caddyBlock}CADDY'
${sudo}systemctl enable caddy || true
${sudo}systemctl restart caddy || true

# Firewall configuration
echo "Configuring firewall..."
if command -v ufw >/dev/null 2>&1; then
  ${sudo}ufw allow OpenSSH || true
  ${sudo}ufw allow 80/tcp || true
  ${sudo}ufw allow 443/tcp || true
  ${sudo}ufw allow ${cfg.runtime.port}/tcp || true
  ${sudo}ufw --force enable || true
elif command -v firewall-cmd >/dev/null 2>&1; then
  ${sudo}firewall-cmd --permanent --add-service=ssh || true
  ${sudo}firewall-cmd --permanent --add-service=http || true
  ${sudo}firewall-cmd --permanent --add-service=https || true
  ${sudo}firewall-cmd --permanent --add-port=${cfg.runtime.port}/tcp || true
  ${sudo}firewall-cmd --reload || true
else
  echo "⚠️  No firewall detected (ufw/firewalld). Skipping firewall configuration."
fi

echo "✅ Provisioning complete!"
`;
}

async function rsyncProject(cfg: Config) {
  const excludes = cfg.deploy.excludes ?? [".git", "node_modules", ".github", "bun.lockb"];
  const excludeArgs = excludes.flatMap((e) => ["--exclude", e]);
  const rsh = cfg.ssh.usePassword
    ? `sshpass -p '${cfg.ssh.password ?? ""}' ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no`
    : cfg.ssh.privateKey
    ? `ssh -i '${cfg.ssh.privateKey}' -o StrictHostKeyChecking=no`
    : "ssh -o StrictHostKeyChecking=no";
  await execa("rsync", [
    "-az",
    "--delete",
    ...excludeArgs,
    "-e",
    rsh,
    "./",
    `${cfg.droplet.user}@${cfg.droplet.host}:${cfg.deploy.path}/`,
  ], { stdio: "inherit" });
}

async function sshExec(cfg: Config, command: string, opts?: { stdin?: string }) {
  const base = buildSshBase(cfg);
  const dest = `${cfg.droplet.user}@${cfg.droplet.host}`;
  if (cfg.ssh.usePassword) {
    await execa("sshpass", ["-p", cfg.ssh.password ?? "", "ssh", ...base, dest, command], {
      stdio: opts?.stdin ? ["pipe", "inherit", "inherit"] : "inherit",
      input: opts?.stdin,
    });
  } else {
    await execa("ssh", [...base, dest, command], {
      stdio: opts?.stdin ? ["pipe", "inherit", "inherit"] : "inherit",
      input: opts?.stdin,
    });
  }
}

async function sshExecQuiet(cfg: Config, command: string): Promise<boolean> {
  const base = buildSshBase(cfg);
  const dest = `${cfg.droplet.user}@${cfg.droplet.host}`;
  try {
    if (cfg.ssh.usePassword) {
      await execa("sshpass", ["-p", cfg.ssh.password ?? "", "ssh", ...base, dest, command], {
        stdio: "pipe",
      });
    } else {
      await execa("ssh", [...base, dest, command], {
        stdio: "pipe",
      });
    }
    return true;
  } catch {
    return false;
  }
}

function buildDotEnv(cfg: Config): string {
  const pairs: string[] = [];
  pairs.push(`HOST=${cfg.runtime.host}`);
  pairs.push(`PORT=${cfg.runtime.port}`);
  pairs.push(`NODE_ENV=${cfg.runtime.nodeEnv}`);
  pairs.push(`SERVICE_NAME=${cfg.service.name}`);
  pairs.push(`APP_DIR=${cfg.app.dir}`);
  pairs.push(`APP_USER=${cfg.app.user}`);
  if (cfg.https) {
    pairs.push(`DOMAIN=${cfg.https.domain}`);
    pairs.push(`EMAIL=${cfg.https.email}`);
  }
  for (const [k, v] of Object.entries(cfg.runtime.env || {})) {
    pairs.push(`${k}=${v}`);
  }
  return pairs.join("\n") + "\n";
}

async function readRemoteDotEnv(cfg: Config): Promise<Record<string, string>> {
  const base = buildSshBase(cfg);
  const dest = `${cfg.droplet.user}@${cfg.droplet.host}`;
  try {
    let result;
    if (cfg.ssh.usePassword) {
      result = await execa("sshpass", ["-p", cfg.ssh.password ?? "", "ssh", ...base, dest, `cat ${cfg.deploy.path}/.env 2>/dev/null || true`]);
    } else {
      result = await execa("ssh", [...base, dest, `cat ${cfg.deploy.path}/.env 2>/dev/null || true`]);
    }
    const lines = result.stdout.split("\n");
    const env: Record<string, string> = {};
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.substring(0, eqIdx);
        const value = trimmed.substring(eqIdx + 1);
        env[key] = value;
      }
    }
    return env;
  } catch {
    return {};
  }
}

async function writeDotEnv(cfg: Config) {
  // Read existing .env from remote
  const existingEnv = await readRemoteDotEnv(cfg);
  
  // Build new env from config
  const pairs: string[] = [];
  pairs.push(`HOST=${cfg.runtime.host}`);
  pairs.push(`PORT=${cfg.runtime.port}`);
  pairs.push(`NODE_ENV=${cfg.runtime.nodeEnv}`);
  pairs.push(`SERVICE_NAME=${cfg.service.name}`);
  pairs.push(`APP_DIR=${cfg.app.dir}`);
  pairs.push(`APP_USER=${cfg.app.user}`);
  if (cfg.https) {
    pairs.push(`DOMAIN=${cfg.https.domain}`);
    pairs.push(`EMAIL=${cfg.https.email}`);
  }
  
  // Parse new env into map
  const newEnv: Record<string, string> = {};
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx > 0) {
      newEnv[pair.substring(0, eqIdx)] = pair.substring(eqIdx + 1);
    }
  }
  
  // Merge runtime.env from config
  for (const [k, v] of Object.entries(cfg.runtime.env || {})) {
    newEnv[k] = v;
  }
  
  // Merge with existing (new config takes precedence)
  const merged = { ...existingEnv, ...newEnv };
  
  // Build final .env content
  const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
  const dotEnv = lines.join("\n") + "\n";
  
  await sshExec(
    cfg,
    `bash -lc 'cat > ${cfg.deploy.path}/.env <<\ENV\n${dotEnv}ENV'`
  );
}

async function provision(cfg: Config) {
  // ensure remote path exists
  await sshExec(cfg, `mkdir -p '${cfg.deploy.path}'`);
  // upload project source first so .env can live with it
  await rsyncProject(cfg);
  // write .env on remote
  await writeDotEnv(cfg);

  // run provisioning script remotely (as root when needed)
  const script = buildProvisionScript(cfg);
  await sshExec(cfg, "bash -lc 'bash -s'", { stdin: script });
}

async function installDepsAndRestart(cfg: Config) {
  const sudo = cfg.droplet.user === "root" ? "" : "sudo ";
  
  // Check if service exists before trying to restart it
  const checkCmd = `${sudo}systemctl list-unit-files | grep -q "^${cfg.service.name}.service"`;
  const serviceExists = await sshExecQuiet(cfg, checkCmd);
  
  let restartCmd: string;
  if (serviceExists) {
    console.log(`♻️  Restarting ${cfg.service.name} service...`);
    restartCmd = `${sudo}systemctl restart ${cfg.service.name}.service`;
  } else {
    console.log(`🚀 Starting ${cfg.service.name} service for the first time...`);
    restartCmd = `${sudo}systemctl start ${cfg.service.name}.service`;
  }
  
  const cmd = `${sudo}chown -R ${cfg.app.user}:${cfg.app.user} '${cfg.deploy.path}' && cd '${cfg.deploy.path}' && if command -v bun >/dev/null 2>&1 && [ -f package.json ]; then bun install --production; fi && ${sudo}systemctl daemon-reload && ${restartCmd} && ${sudo}systemctl reload caddy || true && ${sudo}systemctl status ${cfg.service.name}.service | tail -n 40 | cat`;
  await sshExec(cfg, cmd);
}

async function logs(cfg: Config, lines: number = 200) {
  const sudo = cfg.droplet.user === "root" ? "" : "sudo ";
  const cmd = `${sudo}journalctl -u ${cfg.service.name} -n ${lines} --no-pager | cat`;
  await sshExec(cfg, cmd);
}

async function sshInteractive(cfg: Config) {
  const base = buildSshBase(cfg);
  const dest = `${cfg.droplet.user}@${cfg.droplet.host}`;
  if (cfg.ssh.usePassword) {
    await execa("sshpass", ["-p", cfg.ssh.password ?? "", "ssh", ...base, dest], {
      stdio: "inherit",
    });
  } else {
    await execa("ssh", [...base, dest], {
      stdio: "inherit",
    });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const sub = args[0] || "bootstrap";
  const configPath = args.includes("--config") ? args[args.indexOf("--config") + 1] : undefined;
  const cfg = readConfig(configPath);
  await ensureLocalDeps(cfg);

  switch (sub) {
    case "bootstrap":
      await provision(cfg);
      await installDepsAndRestart(cfg);
      break;
    case "provision":
      await provision(cfg);
      break;
    case "deploy":
      await rsyncProject(cfg);
      await writeDotEnv(cfg);
      await installDepsAndRestart(cfg);
      break;
    case "logs": {
      const linesArg = args.includes("--lines") ? args[args.indexOf("--lines") + 1] : undefined;
      const lines = linesArg ? parseInt(linesArg, 10) : 200;
      await logs(cfg, lines);
      break;
    }
    case "ssh":
      await sshInteractive(cfg);
      break;
    default:
      console.error(`Unknown command: ${sub}. Available: bootstrap, provision, deploy, logs, ssh`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n❌ Error during deployment:\n");
  
  const stderr = err?.stderr || "";
  const message = err?.message || "";
  const fullError = stderr || message || err;
  
  // Provide helpful hints based on common errors
  if (fullError.includes("apt-get: command not found")) {
    console.error("Package manager 'apt-get' not found.\n");
    console.error("💡 This usually means you're on a non-Debian-based distribution.");
    console.error("   vmdrop now supports multiple package managers (apt/dnf/yum/apk).");
    console.error("\nSolution:");
    console.error("   Update vmdrop to the latest version: bunx vmdrop@latest");
    console.error("   Or use the new 'packages:' config section instead of 'apt:'\n");
  } else if (fullError.includes("Permission denied")) {
    console.error("Permission denied.\n");
    console.error("💡 Check your SSH credentials and ensure the user has sudo access.");
    console.error("\nTroubleshooting:");
    console.error("   1. Verify ssh.password or ssh.privateKey in vmdrop.yaml");
    console.error("   2. Ensure droplet.user has sudo privileges");
    console.error("   3. Try: bunx vmdrop ssh  (to test SSH connection)\n");
  } else if (fullError.includes("Could not resolve hostname")) {
    console.error("Could not resolve hostname.\n");
    console.error("💡 Check your droplet.host in vmdrop.yaml");
    console.error("\nTroubleshooting:");
    console.error("   1. Verify the IP address or hostname is correct");
    console.error("   2. Check your network connection\n");
  } else if (fullError.includes("sshpass: command not found")) {
    console.error("sshpass not found.\n");
    console.error("💡 sshpass is required for password authentication.");
    console.error("\nInstall sshpass:");
    console.error("   macOS:  brew install hudochenkov/sshpass/sshpass");
    console.error("   Linux:  sudo apt-get install sshpass");
    console.error("   Or use SSH key authentication instead\n");
  } else {
    console.error(fullError);
  }
  
  console.error("\n📚 Need help? Check the docs or open an issue:");
  console.error("   https://github.com/Livshitz/vmdrop\n");
  
  process.exit(1);
});


