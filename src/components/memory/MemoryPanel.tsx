import { useEffect, useRef, useState } from "react";
import { useAppI18n } from "../../i18n";
import { memoryCommands, type MemoryConfig, type MemoryContext, type MemoryResult, type MemorySource, type MemoryStatus } from "../../services/memoryCommands";
import { useSettingsStore } from "../../store/settingsStore";
import "./memory.css";

export function MemoryPanel({ context }: { context: MemoryContext | null }) {
  const { t } = useAppI18n();
  const [reviewRepository, setReviewRepository] = useState(false);
  if (!context) return <div className="memory memory-panel"><p>{t("memory.noWorkspace")}</p></div>;
  const reviewing = reviewRepository || context.runnerType === "desktop";
  const activeContext: MemoryContext = reviewing ? {
    workspacePath: context.workspacePath,
    sessionId: "workspace-review",
    runnerType: "desktop",
    worktreePath: context.workspacePath,
  } : context;
  // A new context owns a fresh token and results, including when the review scope changes.
  return <div className="memory" style={{ flex: 1, minHeight: 0, gap: 0 }}>
    <div className="memory" style={{ padding: "12px 12px 0" }}>
      <div className="memory-row" role="group" aria-label={t("memory.scope")}>
        <button aria-pressed={!reviewing} disabled={context.runnerType === "desktop"} className={!reviewing ? "memory-primary" : undefined} onClick={() => setReviewRepository(false)}>{t("memory.currentTask")}</button>
        <button aria-pressed={reviewing} className={reviewing ? "memory-primary" : undefined} onClick={() => setReviewRepository(true)}>{t("memory.reviewRepository")}</button>
      </div>
      {reviewing && <p>{t("memory.reviewHint")}</p>}
    </div>
    <ContextMemoryPanel key={JSON.stringify(activeContext)} context={activeContext} />
  </div>;
}

function ContextMemoryPanel({ context }: { context: MemoryContext }) {
  const { t, locale } = useAppI18n();
  const [config, setConfig] = useState<MemoryConfig | null>(null);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [sources, setSources] = useState<MemorySource[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const nextOffset = useRef(0);
  const [results, setResults] = useState<MemoryResult[] | null>(null);
  const [source, setSource] = useState<MemorySource | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const pending = useRef(false);

  const refresh = async (activeToken: string, current: number) => {
    setHasMore(false);
    const [nextStatus, nextSources] = await Promise.allSettled([
      memoryCommands.status(activeToken), memoryCommands.sources(activeToken),
    ]);
    if (generation.current !== current) return;
    if (nextStatus.status === "fulfilled") setStatus(nextStatus.value);
    if (nextSources.status === "fulfilled") {
      setSources(nextSources.value);
      nextOffset.current = nextSources.value.length;
      setHasMore(nextSources.value.length === 200);
    }
    const errors = [nextStatus, nextSources].flatMap((result) => result.status === "rejected" ? [String(result.reason)] : []);
    if (errors.length) setError(errors.join("\n"));
  };

  useEffect(() => {
    const initialize = async () => {
      const attempt = ++generation.current;
      pending.current = true;
      setBusy(true);
      setError("");
      setToken("");
      try {
        const nextConfig = await memoryCommands.config();
        if (generation.current !== attempt) return;
        setConfig(nextConfig);
        const registered = await memoryCommands.register(context);
        if (generation.current !== attempt) return;
        setToken(registered.token);
        await refresh(registered.token, attempt);
      } catch (cause) {
        if (generation.current === attempt) setError(String(cause));
      } finally {
        if (generation.current === attempt) { pending.current = false; setBusy(false); }
      }
    };
    void initialize();
    const onConfig = () => { setResults(null); setSource(null); void initialize(); };
    window.addEventListener("memory-config-changed", onConfig);
    return () => {
      generation.current++;
      window.removeEventListener("memory-config-changed", onConfig);
    };
    // The parent remounts this component whenever any context field changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  const run = async (action: (current: number) => Promise<void>) => {
    if (pending.current || !token) return;
    const current = generation.current;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try { await action(current); }
    catch (cause) { if (generation.current === current) setError(String(cause)); }
    finally { if (generation.current === current) { pending.current = false; setBusy(false); } }
  };

  const viewSource = (id: string) => run(async (current) => {
    const retained = await memoryCommands.source(token, id);
    if (generation.current === current) setSource(retained);
  });
  const changeSource = (item: MemorySource, action: "promote" | "invalidate") => run(async (current) => {
    await memoryCommands[action](token, item.id);
    if (generation.current !== current) return;
    setResults(null);
    if (source?.id === item.id) setSource(null);
    await refresh(token, current);
  });
  const scopeLabel = (scope: string) => t(scope === "repo" || scope === "repository" ? "memory.repo" : scope === "task" ? "memory.task" : scope, { defaultValue: scope });
  const stateLabel = (state: string) => ["pending", "failed", "synced"].includes(state) ? t(`memory.${state}`) : state;
  const formatCollectedAt = (value: string | number) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  };
  const sourceActions = (item: MemorySource) => <div className="memory-row">
    <button disabled={busy} onClick={() => void viewSource(item.id)}>{t("memory.source")}</button>
    {item.scope === "task" && item.state !== "invalidated" && <button disabled={busy} onClick={() => void changeSource(item, "promote")}>{t("memory.promote")}</button>}
    {item.state !== "invalidated" && <button disabled={busy} onClick={() => void changeSource(item, "invalidate")}>{t("memory.invalidate")}</button>}
  </div>;

  return <section className="memory memory-panel" aria-label={t("memory.title")} aria-busy={busy}>
    <div className="memory-row" style={{ justifyContent: "space-between" }}>
      <h3>{t("memory.title")}</h3>
      <button onClick={() => useSettingsStore.getState().openSettings("system")}>{t("memory.settings")}</button>
    </div>
    {config && !config.enabled && <p>{t("memory.disabled")}</p>}
    <p>{t("memory.privateHint")}</p>
    {error && <p className="memory-error" role="alert">{error}</p>}
    {status?.lastError && <p className="memory-error" role="alert">{status.lastError}</p>}
    {notice && <p className="memory-notice" role="status">{notice}</p>}
    {busy && <p role="status">{t("memory.busy")}</p>}
    {status && <div className="memory-row memory-summary">
      {(["pending", "failed", "synced", "sources"] as const).map((key) => <span key={key}>{t(`memory.${key === "sources" ? "statusSources" : key}`)}: {status[key]}</span>)}
    </div>}
    <div className="memory-row">
      <button className="memory-primary" disabled={busy || !token || !config?.enabled} onClick={() => void run(async (current) => {
        const collected = await memoryCommands.collect(token);
        if (generation.current !== current) return;
        setNotice(t("memory.queued", { count: collected.queued }));
        await refresh(token, current);
      })}>{t("memory.collect")}</button>
      <button disabled={busy} onClick={() => { if (token) void run((current) => refresh(token, current)); else setReload((value) => value + 1); }}>{t("memory.refresh")}</button>
    </div>
    <form className="memory" onSubmit={(event) => {
      event.preventDefault();
      if (!query.trim() || !config?.enabled) return;
      void run(async (current) => {
        setResults(null);
        const recalled = await memoryCommands.recall(token, query.trim());
        if (generation.current === current) setResults(recalled.results);
      });
    }}>
      <label>{t("memory.query")}<input type="search" value={query} disabled={busy || !config?.enabled} onChange={(event) => setQuery(event.target.value)} /></label>
      <button type="submit" disabled={busy || !token || !config?.enabled || !query.trim()}>{t("memory.search")}</button>
    </form>
    {source && <section className="memory-card" aria-label={t("memory.snapshot")}>
      <div className="memory-row"><h3>{t("memory.snapshot")}</h3><button onClick={() => setSource(null)}>{t("memory.closeSource")}</button></div>
      <p className="memory-break">{source.locator}</p>
      <p className="memory-break">{t("memory.sourceId")}: {source.id}<br />{t("memory.scope")}: {scopeLabel(source.scope)}<br />{t("memory.state")}: {stateLabel(source.state)}<br />{t("memory.createdAt")}: {formatCollectedAt(source.createdAt)}</p>
      <pre tabIndex={0}>{source.content ?? ""}</pre>
      {source.metadata && <details><summary>{t("memory.metadata")}</summary><pre>{JSON.stringify(source.metadata, null, 2)}</pre></details>}
    </section>}
    {results !== null && <section className="memory" aria-label={t("memory.results")}>
      <h3>{t("memory.results")}</h3>
      {results.length === 0 && <p>{t("memory.noResults")}</p>}
      {results.map((result, index) => <article className="memory-card" key={`${result.id}-${index}`}>
        <div className="memory-break">{result.text}</div>
        <p>{scopeLabel(result.scope)}</p>
        {result.sourceId ? <button disabled={busy} onClick={() => void viewSource(result.sourceId!)}>{t("memory.source")}</button> : <p>{t("memory.sourceMissing")}</p>}
      </article>)}
    </section>}
    <section className="memory" aria-label={t("memory.sources")}>
      <h3>{t("memory.sources")}</h3>
      {!busy && sources.length === 0 && <p>{t("memory.empty")}</p>}
      {sources.map((item) => <article className="memory-card" key={item.id}>
        <div className="memory-break">{item.locator || item.id}</div>
        <p className="memory-break">{item.kind} · {scopeLabel(item.scope)} · {stateLabel(item.state)}</p>
        {sourceActions(item)}
      </article>)}
      {hasMore && <button disabled={busy || !token} onClick={() => void run(async (current) => {
        const page = await memoryCommands.sources(token, nextOffset.current);
        if (generation.current !== current) return;
        nextOffset.current += page.length;
        setSources((previous) => {
          const seen = new Set(previous.map((item) => item.id));
          return [...previous, ...page.filter((item) => !seen.has(item.id))];
        });
        setHasMore(page.length === 200);
      })}>{t("memory.loadMore")}</button>}
    </section>
  </section>;
}
