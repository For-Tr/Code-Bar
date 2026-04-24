import type { TaskDagDiagnostic } from "@codebar/contracts";

export function WorkflowDiagnosticsPanel({ diagnostics }: { diagnostics: TaskDagDiagnostic[] }) {
  if (!diagnostics.length) {
    return <div style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>No diagnostics.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {diagnostics.map((diagnostic) => (
        <div
          key={diagnostic.id}
          style={{
            borderRadius: 10,
            border: "1px solid var(--ci-toolbar-border)",
            background: diagnostic.severity === "error" ? "var(--ci-deleted-bg)" : "var(--ci-card-bg)",
            padding: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ci-text)" }}>{diagnostic.summary}</div>
            <div style={{ fontSize: 10, color: "var(--ci-text-dim)" }}>{diagnostic.severity}</div>
          </div>
          {diagnostic.detail ? (
            <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.6, color: "var(--ci-text-dim)" }}>{diagnostic.detail}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
