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
    const finish = (available) => {
      server.removeAllListeners();
      resolve(available);
    };

    server.unref();
    server.once("error", () => finish(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => finish(true));
    });
  });
}

async function findAvailablePortPair(startPort) {
  let devPort = startPort;

  for (let attempts = 0; attempts < 200; attempts += 1) {
    const hmrPort = devPort + 1;
    const [devAvailable, hmrAvailable] = await Promise.all([
      isPortAvailable(devPort),
      isPortAvailable(hmrPort),
    ]);

    if (devAvailable && hmrAvailable) {
      return { devPort, hmrPort };
    }

    devPort += 2;
  }

  throw new Error(`Unable to find a free dev/HMR port pair starting from ${startPort}`);
}

function spawnPnpm(args, env) {
  const child = spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
    cwd: process.cwd(),
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

const inputArgs = process.argv.slice(2);
const command = inputArgs[0] ?? "dev";

if (command !== "dev") {
  spawnPnpm(["exec", "tauri", ...inputArgs], process.env);
} else {
  const cwd = process.cwd();
  const cwdHash = hashString(cwd);
  const fallbackDevPort = 15000 + ((cwdHash % 2000) * 2);
  const requestedDevPort = readPort("CODE_BAR_DEV_PORT");
  const requestedHmrPort = readPort("CODE_BAR_HMR_PORT");

  let devPort;
  let hmrPort;

  if (requestedDevPort !== null || requestedHmrPort !== null) {
    devPort = requestedDevPort ?? fallbackDevPort;
    hmrPort = requestedHmrPort ?? (devPort + 1);

    const [devAvailable, hmrAvailable] = await Promise.all([
      isPortAvailable(devPort),
      isPortAvailable(hmrPort),
    ]);

    if (!devAvailable || !hmrAvailable) {
      throw new Error(
        `Requested dev ports are busy: CODE_BAR_DEV_PORT=${devPort}, CODE_BAR_HMR_PORT=${hmrPort}`,
      );
    }
  } else {
    ({ devPort, hmrPort } = await findAvailablePortPair(fallbackDevPort));
  }

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
    identifier:
      process.env.CODE_BAR_TAURI_IDENTIFIER || `com.xiangbingzhou.codebar.${cwdHash.toString(36)}`,
    build: {
      devUrl: `http://localhost:${devPort}`,
    },
  };

  if (devPort !== fallbackDevPort) {
    console.log(
      `[worktree-dev] preferred dev port ${fallbackDevPort} is busy, switched to ${devPort}`,
    );
  }
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
    ...inputArgs.slice(command === "dev" ? 1 : 0),
  ];

  spawnPnpm(tauriArgs, env);
}
