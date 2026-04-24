import type { TaskDagEvent } from "@codebar/contracts";

export function WorkflowEventTimeline({ events }: { events: TaskDagEvent[] }) {
  if (!events.length) {
    return <div style={{ fontSize: 11, color: "var(--ci-text-dim)" }}>No workflow events yet.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {events.slice().reverse().map((event) => (
        <div
          key={event.id}
          style={{
            borderRadius: 10,
            border: "1px solid var(--ci-toolbar-border)",
            background: "var(--ci-card-bg)",
            padding: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ci-text)" }}>{event.kind}</div>
            <div style={{ fontSize: 10, color: "var(--ci-text-dim)" }}>{event.createdAt}</div>
          </div>
          <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.6, color: "var(--ci-text-dim)" }}>{event.message}</div>
        </div>
      ))}
    </div>
  );
}
