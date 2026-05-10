import { useEffect, useRef, useState } from "react";
import { useAppI18n } from "../../i18n";
import { memoryCommands, type MemoryConfig } from "../../services/memoryCommands";
import "./memory.css";

export function MemorySettings() {
  const { t } = useAppI18n();
  const [config, setConfig] = useState<MemoryConfig | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setError("");
    memoryCommands.config().then((value) => {
      if (current === generation.current) setConfig(value);
    }).catch((cause) => {
      if (current === generation.current) setError(String(cause));
    });
    return () => { generation.current++; };
  }, [reload]);

  const save = async () => {
    if (!config || busy) return;
    setError("");
    setSaved(false);
    if (config.enabled || config.baseUrl.trim()) {
      try {
        const url = new URL(config.baseUrl.trim());
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
      } catch { setError(t("memory.invalidUrl")); return; }
    }
    const current = generation.current;
    setBusy(true);
    try {
      const result = await memoryCommands.configure({
        enabled: config.enabled, baseUrl: config.baseUrl.trim(), autoCollect: config.autoCollect, llmBaseUrl: config.llmBaseUrl.trim(), llmModel: config.llmModel.trim(),
        ...(removeKey ? { apiKey: "" } : apiKey ? { apiKey } : {}),
      });
      window.dispatchEvent(new Event("memory-config-changed"));
      if (current !== generation.current) return;
      setConfig(result);
      setApiKey("");
      setRemoveKey(false);
      setSaved(true);
    } catch (cause) {
      if (current === generation.current) setError(String(cause));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };

  return <section className="memory memory-settings" aria-label={t("memory.title")}>
    <h3>{t("memory.title")}</h3>
    <p>{t("memory.description")}</p>
    <p>{t("memory.consent")}</p>
    {error && <p role="alert" className="memory-error">{error}</p>}
    {!config && error && <button onClick={() => setReload((value) => value + 1)}>{t("memory.refresh")}</button>}
    {!config && !error && <p role="status">{t("memory.loading")}</p>}
    {config && <>
      <label className="memory-check"><input type="checkbox" checked={config.enabled} disabled={busy} onChange={(event) => { setConfig({ ...config, enabled: event.target.checked }); setSaved(false); }} />{t("memory.enabled")}</label>
      <label>{t("memory.baseUrl")}<input type="url" value={config.baseUrl} placeholder="http://localhost:8888" disabled={busy} onChange={(event) => { setConfig({ ...config, baseUrl: event.target.value }); setSaved(false); }} /></label>
      <label>{t("memory.apiKey")}<input type="password" autoComplete="new-password" value={apiKey} disabled={busy || removeKey} placeholder={t(config.hasApiKey ? "memory.keySaved" : "memory.keyOptional")} onChange={(event) => { setApiKey(event.target.value); setSaved(false); }} /></label>
      <label>模型服务地址<input type="url" value={config.llmBaseUrl} disabled={busy} onChange={(event) => { setConfig({ ...config, llmBaseUrl: event.target.value }); setSaved(false); }} /></label>
      <label>提取模型<input type="text" value={config.llmModel} disabled={busy} onChange={(event) => { setConfig({ ...config, llmModel: event.target.value }); setSaved(false); }} /></label>
      {config.hasApiKey && <label className="memory-check"><input type="checkbox" disabled={busy} checked={removeKey} onChange={(event) => { setRemoveKey(event.target.checked); setSaved(false); }} />{t("memory.removeKey")}</label>}
      <label className="memory-check"><input type="checkbox" checked={config.autoCollect} disabled={busy} onChange={(event) => { setConfig({ ...config, autoCollect: event.target.checked }); setSaved(false); }} />{t("memory.autoCollect")}</label>
      <div className="memory-row"><button className="memory-primary" disabled={busy} onClick={() => void save()}>{t(busy ? "memory.busy" : "memory.save")}</button>{saved && <span role="status">{t("memory.saved")}</span>}</div>
    </>}
  </section>;
}
