import type { TaskDagDocument, WorkflowLifecycle } from "@codebar/contracts";
import type { WorkflowObjectTab } from "../../store/workbenchStore";
import { resolveWorkflowOverviewCta } from "./workflowObjectModel";

export function WorkflowOverviewTab({
  document,
  lifecycle,
  submitForReviewPending,
  confirmTaskPending,
  onSubmitForReview,
  onConfirmTask,
  onOpenTab,
}: {
  document: TaskDagDocument;
  lifecycle: WorkflowLifecycle;
  submitForReviewPending: boolean;
  confirmTaskPending: boolean;
  onSubmitForReview: () => void;
  onConfirmTask: () => void;
  onOpenTab: (tab: WorkflowObjectTab) => void;
}) {
  const cta = resolveWorkflowOverviewCta(lifecycle);
  const canSubmitForReview = lifecycle === "draft" && !!document.capabilities.canSubmitForReview;
  const canConfirmTask = lifecycle === "in_review" && !!document.capabilities.canConfirm;

  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{
        borderRadius: 12,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-panel-bg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
          Goal
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ci-text)" }}>
          {document.task.title}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.7, color: "var(--ci-text-dim)" }}>
          {document.task.goal ?? document.task.prompt}
        </div>
      </div>

      <div style={{
        borderRadius: 12,
        border: "1px solid var(--ci-toolbar-border)",
        background: "var(--ci-panel-bg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ci-text-dim)" }}>
          Next action
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ci-text)" }}>
          {cta.title}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.7, color: "var(--ci-text-dim)" }}>
          {cta.detail}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {lifecycle === "draft" ? (
            <button
              disabled={!canSubmitForReview || submitForReviewPending}
              onClick={onSubmitForReview}
              style={primaryButtonStyle(!canSubmitForReview || submitForReviewPending)}
            >
              {submitForReviewPending ? "Submitting…" : "Submit for review"}
            </button>
          ) : lifecycle === "in_review" ? (
            <button
              disabled={!canConfirmTask || confirmTaskPending}
              onClick={onConfirmTask}
              style={primaryButtonStyle(!canConfirmTask || confirmTaskPending)}
            >
              {confirmTaskPending ? "Confirming…" : "Confirm workflow"}
            </button>
          ) : null}
          <button onClick={() => onOpenTab(cta.targetTab)} style={secondaryButtonStyle(false)}>{cta.buttonLabel}</button>
        </div>
      </div>
    </div>
  );
}

function primaryButtonStyle(disabled: boolean) {
  return {
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: "var(--ci-accent-bg)",
    color: "var(--ci-accent)",
    border: "1px solid var(--ci-accent-bdr)",
  } as const;
}

function secondaryButtonStyle(disabled: boolean) {
  return {
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: "var(--ci-btn-ghost-bg)",
    color: "var(--ci-text)",
    border: "1px solid var(--ci-toolbar-border)",
  } as const;
}
