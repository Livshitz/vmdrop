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
    })
    .default({ name: "doscaffold", execStart: "/usr/local/bin/bun run src/server.ts" }),
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
  apt: z
    .object({
      packages: z.array(z.string()).default([]),
    })
    .default({ packages: [] }),
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

  const defaultApt = [
    "curl",
    "ca-certificates",
    "rsync",
    "ufw",
    "caddy",
    "unzip",
    "ffmpeg",
  ];
  const apt = Array.from(new Set([...defaultApt, ...cfg.apt.packages]));

  const sudo = cfg.droplet.user === "root" ? "" : "sudo ";

  const caddyBlock = needsHttps
    ? `\n{\n        email ${email}\n}\n\n${domain} {\n        encode zstd gzip\n        reverse_proxy 127.0.0.1:${cfg.runtime.port}\n}\n\n`
    : `:80 {\n        encode zstd gzip\n        reverse_proxy 127.0.0.1:${cfg.runtime.port}\n}\n\n`;

  const systemdUnit = `\n[Unit]\nDescription=${cfg.app.name} Service\nAfter=network.target\n\n[Service]\nUser=${cfg.app.user}\nWorkingDirectory=${cfg.app.dir}\n${runtimeEnvLines.join("\n")}\nEnvironmentFile=${cfg.app.dir}/.env\nExecStart=${cfg.service.execStart}\nRestart=always\nRestartSec=2\nKillSignal=SIGINT\n\n[Install]\nWantedBy=multi-user.target\n`;

  return `set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

wait_for_apt() {
  while pgrep -x apt >/dev/null 2>&1 || pgrep -x apt-get >/dev/null 2>&1 || pgrep -x dpkg >/dev/null 2>&1; do
    echo "Waiting for apt lock..." >&2
    sleep 5
  done
}

wait_for_apt
${sudo}apt-get update -y
wait_for_apt
${sudo}apt-get upgrade -y
wait_for_apt
${sudo}apt-get install -y ${apt.join(" ")}

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

# UFW basic rules
${sudo}ufw allow OpenSSH || true
${sudo}ufw allow 80/tcp || true
${sudo}ufw allow 443/tcp || true
${sudo}ufw allow ${cfg.runtime.port}/tcp || true
${sudo}ufw --force enable || true
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
  const cmd = `${sudo}chown -R ${cfg.app.user}:${cfg.app.user} '${cfg.deploy.path}' && cd '${cfg.deploy.path}' && if command -v bun >/dev/null 2>&1 && [ -f package.json ]; then bun install --production; fi && ${sudo}systemctl daemon-reload && ${sudo}systemctl restart ${cfg.service.name}.service && ${sudo}systemctl reload caddy || true && ${sudo}systemctl status ${cfg.service.name}.service | tail -n 40 | cat`;
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
  console.error(err?.stderr || err?.message || err);
  process.exit(1);
});


