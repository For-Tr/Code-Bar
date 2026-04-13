import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RUNNER_LABELS, type RunnerType } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";

interface RunnerUsageSnapshot {
  runner_type: string;
  source: string;
  auth_status: string | null;
  usage_summary: string | null;
  cost_summary: string | null;
  raw_text: string | null;
  last_refreshed_at: string;
  error: string | null;
}

export function UsageWidgetCard() {
  const sessions = useSessionStore((s) => s.sessions);
  const expandedSessionId = useSessionStore((s) => s.expandedSessionId);
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<RunnerUsageSnapshot | null>(null);

  const runnerType = useMemo<RunnerType>(() => {
    const session = sessions.find((item) => item.id === expandedSessionId) ?? null;
    return session?.runner.type ?? "claude-code";
  }, [expandedSessionId, sessions]);

  const handleRefresh = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const next = await invoke<RunnerUsageSnapshot>("refresh_runner_usage", { runnerType });
      setSnapshot(next);
    } catch (error) {
      setSnapshot({
        runner_type: runnerType,
        source: "unsupported",
        auth_status: null,
        usage_summary: null,
        cost_summary: null,
        raw_text: null,
        last_refreshed_at: String(Date.now()),
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      width: "100%",
      height: "100%",
      padding: 12,
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      color: "var(--ci-text)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--ci-text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
            Usage
          </div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {RUNNER_LABELS[runnerType]}
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          style={{
            background: "var(--ci-accent-bg)",
            border: "1px solid var(--ci-accent-bdr)",
            color: "var(--ci-accent)",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 11,
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "刷新中" : "刷新"}
        </button>
      </div>

      <div style={{
        flex: 1,
        minHeight: 0,
        borderRadius: 10,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-surface)",
        padding: 10,
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}>
        {!snapshot && !loading && (
          <div style={{ fontSize: 12, color: "var(--ci-text-dim)", lineHeight: 1.6 }}>
            点击刷新，手动查询当前 runner 的 usage / status 信息。
          </div>
        )}

        {snapshot?.error && (
          <div style={{ fontSize: 12, color: "var(--ci-red)", lineHeight: 1.6 }}>
            {snapshot.error}
          </div>
        )}

        {snapshot?.auth_status && (
          <div>
            <div style={{ fontSize: 10, color: "var(--ci-text-dim)", marginBottom: 3 }}>Auth</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{snapshot.auth_status}</div>
          </div>
        )}

        {snapshot?.usage_summary && (
          <div>
            <div style={{ fontSize: 10, color: "var(--ci-text-dim)", marginBottom: 3 }}>Usage</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{snapshot.usage_summary}</div>
          </div>
        )}

        {snapshot?.cost_summary && (
          <div>
            <div style={{ fontSize: 10, color: "var(--ci-text-dim)", marginBottom: 3 }}>Cost</div>
            <div style={{ fontSize: 12, lineHeight: 1.6 }}>{snapshot.cost_summary}</div>
          </div>
        )}

        {snapshot?.source && (
          <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10, color: "var(--ci-text-dim)" }}>
            <span>source: {snapshot.source}</span>
            <span>{snapshot.last_refreshed_at}</span>
          </div>
        )}
      </div>
    </div>
  );
}
