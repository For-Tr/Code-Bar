import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { ensureI18n } from "./i18n/config";
import { resolveEffectiveLocale } from "./i18n/locale";
import { useSettingsStore } from "./store/settingsStore";
import { bootstrapPersistState } from "./store/persistStorage";

function renderFatalBootError(error: unknown) {
  const root = document.getElementById("root");
  if (!root) return;
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack ?? "" : "";
  root.innerHTML = `
    <div style="
      height: 100vh;
      box-sizing: border-box;
      padding: 16px;
      overflow: auto;
      background: #111;
      color: #ff6b6b;
      font: 12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;
      white-space: pre-wrap;
    ">${message}${stack ? `\n\n${stack}` : ""}</div>
  `;
}

async function main() {
  await bootstrapPersistState();
  const locale = resolveEffectiveLocale(useSettingsStore.getState().settings.locale);
  await ensureI18n(locale);

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void main().catch((error) => {
  console.error("[frontend] bootstrap failed", error);
  renderFatalBootError(error);
});
