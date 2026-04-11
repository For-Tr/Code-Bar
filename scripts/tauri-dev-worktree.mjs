import { spawn } from "node:child_process";
import net from "node:net";
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

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePortPair(baseDevPort, hmrOffset) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const devPort = baseDevPort + (attempt * 2);
    const hmrPort = devPort + hmrOffset;
    if (hmrPort > 65535) break;
    const [devAvailable, hmrAvailable] = await Promise.all([
      isPortAvailable(devPort),
      isPortAvailable(hmrPort),
    ]);
    if (devAvailable && hmrAvailable) {
      return { devPort, hmrPort };
    }
  }
  throw new Error(`No available dev/hmr port pair found from base port ${baseDevPort}`);
}

function spawnTauri(args, env, cwd) {
  const child = spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
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
}

async function main() {
  const cwd = process.cwd();
  const argv = process.argv.slice(2);
  const command = argv[0] ?? "dev";

  if (command !== "dev") {
    spawnTauri(["exec", "tauri", ...argv], process.env, cwd);
    return;
  }

  const cwdHash = hashString(cwd);
  const fallbackDevPort = 15000 + ((cwdHash % 2000) * 2);
  const requestedDevPort = readPort("CODE_BAR_DEV_PORT") ?? fallbackDevPort;
  const requestedHmrPort = readPort("CODE_BAR_HMR_PORT");
  const hmrOffset = requestedHmrPort ? Math.max(1, requestedHmrPort - requestedDevPort) : 1;
  const { devPort, hmrPort } = await findAvailablePortPair(requestedDevPort, hmrOffset);
  const worktreeName = path.basename(cwd);
  const suffix =
    worktreeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
    `wt-${cwdHash.toString(36)}`;

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

  spawnTauri(
    [
      "exec",
      "tauri",
      "dev",
      "--config",
      JSON.stringify(overrideConfig),
      ...argv.slice(1),
    ],
    env,
    cwd
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
