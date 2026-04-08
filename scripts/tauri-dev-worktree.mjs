import { spawn } from "node:child_process";
import path from "node:path";

function hashString(input) {
  let hash = 0;
  for (const ch of input) {
    hash = ((hash * 31) + ch.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function readPort(name) {
  const value = process.env[name];
  if (!value) return null;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${name} must be a valid TCP port, got: ${value}`);
  }
  return port;
}

const cwd = process.cwd();
const cwdHash = hashString(cwd);
const fallbackDevPort = 15000 + ((cwdHash % 2000) * 2);
const devPort = readPort("CODE_BAR_DEV_PORT") ?? fallbackDevPort;
const hmrPort = readPort("CODE_BAR_HMR_PORT") ?? (devPort + 1);
const worktreeName = path.basename(cwd);
const suffix = worktreeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `wt-${cwdHash.toString(36)}`;

const env = {
  ...process.env,
  CODE_BAR_DEV_PORT: String(devPort),
  CODE_BAR_HMR_PORT: String(hmrPort),
};

const overrideConfig = {
  productName: process.env.CODE_BAR_TAURI_PRODUCT_NAME || `Code Bar (${suffix})`,
  identifier: process.env.CODE_BAR_TAURI_IDENTIFIER || `com.xiangbingzhou.codebar.${cwdHash.toString(36)}`,
  build: {
    devUrl: `http://localhost:${devPort}`,
  },
};

console.log(`[worktree-dev] cwd=${cwd}`);
console.log(`[worktree-dev] devUrl=http://localhost:${devPort}`);
console.log(`[worktree-dev] hmrPort=${hmrPort}`);
console.log(`[worktree-dev] identifier=${overrideConfig.identifier}`);

const tauriArgs = [
  "exec",
  "tauri",
  "dev",
  "--config",
  JSON.stringify(overrideConfig),
  ...process.argv.slice(2),
];

const child = spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", tauriArgs, {
  cwd,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
