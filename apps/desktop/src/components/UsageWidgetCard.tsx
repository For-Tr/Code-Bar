import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatDate, formatTime, useAppI18n } from "../i18n";
import { RUNNER_LABELS, type RunnerType } from "../store/settingsStore";
import { useSessionStore } from "../store/sessionStore";
import { resolveDaemonApproval } from "../services/daemonCommands";
import { useDaemonData } from "../daemon/DaemonDataProvider";

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
    top: formatTime(date),
    bottom: formatDate(date),
  };
}

function FlatProgress({ label, leftPercent, reset }: { label: string; leftPercent: number; reset: { top: string; bottom: string } }) {
  const clamped = Math.max(0, Math.min(100, leftPercent));
  const tone = clamped <= 15 ? "var(--ci-red)" : clamped <= 40 ? "var(--ci-yellow-dark)" : "var(--ci-accent)";
  return (
    <div style={{ display: "grid", gap: 6, padding: "8px 9px", borderRadius: 10, background: "var(--ci-surface)", border: "1px solid var(--ci-toolbar-border)" }}>
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
  const { t } = useAppI18n();
  const sessions = useSessionStore((s) => s.sessions);
  const expandedSessionId = useSessionStore((s) => s.expandedSessionId);
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<RunnerUsageSnapshot | null>(null);
  const refreshAbortRef = useRef(false);

  const daemon = useDaemonData();

  const session = useMemo(() => sessions.find((item) => item.id === expandedSessionId) ?? null, [expandedSessionId, sessions]);

  const sessionNextAction = session ? daemon.state.nextActionBySessionId[session.id] : undefined;
  const sessionApprovals = session ? (daemon.state.approvalsBySessionId[session.id] ?? []) : [];
  const sessionDiagnostics = session ? daemon.state.diagnosticsBySessionId[session.id] : undefined;

  const runnerType = useMemo<RunnerType>(() => {
    return session?.runner.type ?? "claude-code";
  }, [session]);

  const parsedWindows = useMemo(() => {
    if (!snapshot?.usage_summary) return { fiveHour: null, weekly: null };
    return {
      fiveHour: parseUsageLine(snapshot.usage_summary, "5h"),
      weekly: parseUsageLine(snapshot.usage_summary, "7d"),
    };
  }, [snapshot?.usage_summary]);

  const refreshOrchestration = async () => {
    if (!session) return;
    await daemon.refreshSessionViews(session.id);
  }

  const handleRefresh = async () => {
    if (loading) return;
    setLoading(true);
    const requestRunner = runnerType;
    try {
      const next = await invoke<RunnerUsageSnapshot>("refresh_runner_usage", { runnerType: requestRunner });
      if (refreshAbortRef.current || requestRunner !== runnerType) return;
      setSnapshot(next);
      await refreshOrchestration();
    } catch (error) {
      if (refreshAbortRef.current || requestRunner !== runnerType) return;
      setSnapshot({
        runner_type: requestRunner,
        source: "unsupported",
        auth_status: null,
        usage_summary: null,
        cost_summary: null,
        raw_text: null,
        last_refreshed_at: String(Date.now()),
        error: error instanceof Error ? error.message : String(error),
      });
      await refreshOrchestration();
    } finally {
      if (!refreshAbortRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    refreshAbortRef.current = false;
    setSnapshot(null);
    setLoading(false);
    void handleRefresh();
    const timer = window.setInterval(() => {
      void handleRefresh();
    }, 3 * 60 * 1000);
    return () => {
      refreshAbortRef.current = true;
      window.clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnerType]);

  return (
    <div style={{
      width: "100%",
      height: "100%",
      padding: 9,
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      color: "var(--ci-text)",
      overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ci-text-muted)" }}>
            {RUNNER_LABELS[runnerType]}
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          style={{
            background: "var(--ci-btn-ghost-bg)",
            border: "1px solid var(--ci-toolbar-border)",
            color: "var(--ci-text-muted)",
            borderRadius: 7,
            padding: "4px 8px",
            fontSize: 11,
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? t("usage.refreshing") : t("usage.refresh")}
        </button>
      </div>

      <div style={{ display: "grid", gap: 8, flex: 1, minHeight: 0, overflowY: "auto" }}>
        {session && sessionNextAction && (
          <div style={{ fontSize: 11, color: "var(--ci-text)", lineHeight: 1.5, padding: "8px 9px", borderRadius: 10, background: "var(--ci-surface)", border: "1px solid var(--ci-toolbar-border)", display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 10, color: "var(--ci-text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Next action</div>
            <div>{sessionNextAction?.recommendedNextCalls.join(", ") || "—"}</div>
            {sessionNextAction?.step?.title && (
              <div style={{ color: 'var(--ci-text-dim)' }}>{sessionNextAction?.step?.title}</div>
            )}
            <button
              onClick={() => void refreshOrchestration()}
              style={{ justifySelf: 'start', background: 'var(--ci-btn-ghost-bg)', border: '1px solid var(--ci-toolbar-border)', color: 'var(--ci-text-muted)', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
            >
              Refresh hints
            </button>
          </div>
        )}

        {session && sessionApprovals?.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--ci-text)", lineHeight: 1.5, padding: "8px 9px", borderRadius: 10, background: "var(--ci-yellow-bg)", border: "1px solid var(--ci-yellow-bdr)", display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 10, color: "var(--ci-text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Approvals</div>
            {sessionApprovals.map((approval) => (
              <div key={approval.id} style={{ display: 'grid', gap: 6, paddingTop: 4, borderTop: '1px solid var(--ci-yellow-bdr)' }}>
                <div style={{ fontWeight: 600 }}>{approval.title}</div>
                <div style={{ color: 'var(--ci-text-dim)' }}>{approval.description}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => {
                      void resolveDaemonApproval(approval.id, 'approved').then(() => refreshOrchestration())
                    }}
                    style={{ background: 'var(--ci-accent-bg)', border: '1px solid var(--ci-accent-bdr)', color: 'var(--ci-accent)', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => {
                      void resolveDaemonApproval(approval.id, 'rejected').then(() => refreshOrchestration())
                    }}
                    style={{ background: 'var(--ci-deleted-bg)', border: '1px solid var(--ci-toolbar-border)', color: 'var(--ci-deleted-text)', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {session && sessionDiagnostics && (
          <div style={{ fontSize: 11, color: "var(--ci-text)", lineHeight: 1.5, padding: "8px 9px", borderRadius: 10, background: "var(--ci-surface)", border: "1px solid var(--ci-toolbar-border)" }}>
            <div style={{ fontSize: 10, color: "var(--ci-text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Diagnostics</div>
            <div>{sessionDiagnostics.summary}</div>
          </div>
        )}

        {snapshot?.error && (
          <div style={{ fontSize: 12, color: "var(--ci-red)", lineHeight: 1.5, padding: "8px 9px", borderRadius: 10, background: "var(--ci-deleted-bg)", border: "1px solid var(--ci-toolbar-border)" }}>
            {snapshot.error}
          </div>
        )}

        {parsedWindows.fiveHour && (
          <FlatProgress label="5h" leftPercent={parsedWindows.fiveHour.leftPercent} reset={formatResetText(parsedWindows.fiveHour.resetRaw)} />
        )}

        {parsedWindows.weekly && (
          <FlatProgress label="7d" leftPercent={parsedWindows.weekly.leftPercent} reset={formatResetText(parsedWindows.weekly.resetRaw)} />
        )}

        {!snapshot && !loading && (
          <div style={{ fontSize: 12, color: "var(--ci-text-dim)", lineHeight: 1.6, padding: "8px 9px", borderRadius: 10, background: "var(--ci-surface)", border: "1px solid var(--ci-toolbar-border)" }}>
            {t("usage.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
