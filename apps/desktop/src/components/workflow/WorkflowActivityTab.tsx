import type { TaskDagDiagnostic, TaskDagEvent, WorkflowLifecycle } from "@codebar/contracts";
import { WorkflowDiagnosticsPanel } from "./WorkflowDiagnosticsPanel";
import { WorkflowEventTimeline } from "./WorkflowEventTimeline";

export function WorkflowActivityTab({
  lifecycle,
  diagnostics,
  events,
}: {
  lifecycle: WorkflowLifecycle;
  diagnostics: TaskDagDiagnostic[];
  events: TaskDagEvent[];
}) {
  return (
    <div style={{ padding: 18, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, minHeight: 0 }}>
      <div style={{
        borderRadius: 12,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-panel-bg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: 0,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
          Diagnostics · {lifecycle}
        </div>
        <div style={{ minHeight: 0, overflow: "auto" }}>
          <WorkflowDiagnosticsPanel diagnostics={diagnostics} />
        </div>
      </div>
      <div style={{
        borderRadius: 12,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-panel-bg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minHeight: 0,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
          Events
        </div>
        <div style={{ minHeight: 0, overflow: "auto" }}>
          <WorkflowEventTimeline events={events} />
        </div>
      </div>
    </div>
  );
}
