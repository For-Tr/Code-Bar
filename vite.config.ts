import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const envPort = process.env.CODE_BAR_DEV_PORT;
// @ts-expect-error process is a nodejs global
const envHmrPort = process.env.CODE_BAR_HMR_PORT;

function parsePort(value: string | undefined, fallback: number): number {
  const port = Number.parseInt(value ?? "", 10);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

const devPort = parsePort(envPort, 1420);
const hmrPort = parsePort(envHmrPort, devPort + 1);

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: devPort,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: hmrPort,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
