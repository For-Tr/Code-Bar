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

function parseUsageLine(text: string, label: string) {
  const regex = new RegExp(`${label} usage: (\\d+(?:\\.\\d+)?)%\\n${label} reset: ([^\\n]+)`, "i");
  const match = text.match(regex);
  if (!match) return null;
  const usedPercent = Number(match[1]);
  return {
    usedPercent,
    leftPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
    resetRaw: match[2],
  };
}

function formatResetText(raw: string) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return { top: raw, bottom: "" };
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return { top: raw, bottom: "" };
  return {
    top: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    bottom: date.toLocaleDateString(),
  };
}

function FlatProgress({ label, leftPercent, reset }: { label: string; leftPercent: number; reset: { top: string; bottom: string } }) {
  const clamped = Math.max(0, Math.min(100, leftPercent));
  const tone = clamped <= 15 ? "var(--ci-red)" : clamped <= 40 ? "var(--ci-yellow-dark)" : "var(--ci-accent)";
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "var(--ci-text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label} limit</span>
        <span style={{ fontSize: 11, color: tone, fontWeight: 600 }}>{clamped.toFixed(0)}% left</span>
      </div>
      <div style={{ height: 6, background: "var(--ci-btn-ghost-bg)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${clamped}%`, height: "100%", background: tone, borderRadius: 999 }} />
      </div>
      <div style={{ display: "grid", gap: 1, fontSize: 10, color: "var(--ci-text-dim)", lineHeight: 1.3 }}>
        <span>{reset.top}</span>
        {reset.bottom && <span>{reset.bottom}</span>}
      </div>
    </div>
  );
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

  const parsedWindows = useMemo(() => {
    if (!snapshot?.usage_summary) return { fiveHour: null, weekly: null };
    return {
      fiveHour: parseUsageLine(snapshot.usage_summary, "5h"),
      weekly: parseUsageLine(snapshot.usage_summary, "7d"),
    };
  }, [snapshot?.usage_summary]);

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
      padding: 10,
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      color: "var(--ci-text)",
      overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ci-text)" }}>
          {RUNNER_LABELS[runnerType]}
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          style={{
            background: "transparent",
            border: "1px solid var(--ci-toolbar-border)",
            color: "var(--ci-text-muted)",
            borderRadius: 8,
            padding: "5px 9px",
            fontSize: 11,
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "刷新中" : "刷新"}
        </button>
      </div>

      <div style={{ display: "grid", gap: 6, flex: 1, minHeight: 0, overflowY: "auto" }}>
        {snapshot?.error && (
          <div style={{ fontSize: 12, color: "var(--ci-red)", lineHeight: 1.5 }}>
            {snapshot.error}
          </div>
        )}

        {parsedWindows.fiveHour && (
          <div style={{ paddingTop: 4, borderTop: "1px solid var(--ci-toolbar-border)" }}>
            <FlatProgress label="5h" leftPercent={parsedWindows.fiveHour.leftPercent} reset={formatResetText(parsedWindows.fiveHour.resetRaw)} />
          </div>
        )}

        {parsedWindows.weekly && (
          <div style={{ paddingTop: 4, borderTop: "1px solid var(--ci-toolbar-border)" }}>
            <FlatProgress label="7d" leftPercent={parsedWindows.weekly.leftPercent} reset={formatResetText(parsedWindows.weekly.resetRaw)} />
          </div>
        )}

        {!snapshot && !loading && (
          <div style={{ fontSize: 12, color: "var(--ci-text-dim)", lineHeight: 1.6, paddingTop: 4, borderTop: "1px solid var(--ci-toolbar-border)" }}>
            点击刷新，查询当前限额状态。
          </div>
        )}
      </div>
    </div>
  );
}
