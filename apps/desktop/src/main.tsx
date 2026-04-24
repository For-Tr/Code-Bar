import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { ensureI18n } from "./i18n/config";
import { resolveEffectiveLocale } from "./i18n/locale";
import { useSettingsStore } from "./store/settingsStore";
import { bootstrapPersistState } from "./store/persistStorage";

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

void main();
