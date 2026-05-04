// @ts-ignore test-only Node builtins are available at runtime.
import assert from "node:assert/strict";
// @ts-ignore test-only Node builtins are available at runtime.
import test from "node:test";
import type { TaskDagDocument } from "@codebar/contracts";
import {
  canRunWorkflowExecutionSetupActions,
  collectWorkflowExecutionSessions,
  resolveWorkflowOverviewCta,
} from "./workflowObjectModel.ts";

function makeDocument(): TaskDagDocument {
  return {
    graphId: "task-1",
    revision: "rev-1",
    layoutVersion: 1,
    capabilities: {
      canRefresh: true,
      canClaimStep: true,
      canCompleteStep: true,
      canBlockStep: true,
      canResolveApproval: true,
      canAttachSession: true,
      canLaunchSession: true,
      canSendSessionInput: true,
      canSubmitForReview: true,
      canConfirm: true,
      canCreateSession: true,
      canStartWorkflow: true,
    },
    task: {
      id: "task-1",
      title: "Ship workflow control plane",
      prompt: "Redesign workflow",
      status: "active",
      lifecycle: "running",
      workspaceId: "workspace-1",
      activeSessionId: "session-1",
    },
    nodes: [
      {
        kind: "step",
        id: "step-node-1",
        stepId: "step-1",
        label: "Refactor sidebar",
        status: "running",
        dependsOn: [],
        requiredSkills: [],
        allowedProviders: ["claude_code"],
        parallelizable: false,
        x: 0,
        y: 0,
        runtime: {
          currentSession: {
            id: "session-1",
            provider: "claude_code",
            state: "running",
          },
          recommendedNextActions: [],
        },
      },
      {
        kind: "step",
        id: "step-node-2",
        stepId: "step-2",
        label: "Refactor workflow view",
        status: "ready",
        dependsOn: ["step-1"],
        requiredSkills: [],
        allowedProviders: ["claude_code"],
        parallelizable: false,
        x: 0,
        y: 0,
        runtime: {
          currentSession: {
            id: "session-2",
            provider: "codex",
            state: "waiting_input",
          },
          recommendedNextActions: [],
        },
      },
    ],
    edges: [],
  };
}

test("collectWorkflowExecutionSessions returns one summary per session-bound step", () => {
  const sessions = collectWorkflowExecutionSessions(makeDocument());

  assert.deepEqual(sessions, [
    {
      sessionId: "session-1",
      provider: "claude_code",
      state: "running",
      stepId: "step-1",
      stepLabel: "Refactor sidebar",
    },
    {
      sessionId: "session-2",
      provider: "codex",
      state: "waiting_input",
      stepId: "step-2",
      stepLabel: "Refactor workflow view",
    },
  ]);
});

test("resolveWorkflowOverviewCta matches each workflow lifecycle branch", () => {
  assert.deepEqual(resolveWorkflowOverviewCta("draft"), {
    title: "Draft the workflow",
    detail: "Refine scope and decomposition before sending it for review.",
    buttonLabel: "Review Graph",
    targetTab: "graph",
  });

  assert.deepEqual(resolveWorkflowOverviewCta("in_review"), {
    title: "Confirm the workflow",
    detail: "Inspect the graph and blockers before confirming the plan.",
    buttonLabel: "Open Graph",
    targetTab: "graph",
  });

  assert.deepEqual(resolveWorkflowOverviewCta("confirmed"), {
    title: "Prepare execution",
    detail: "Attach or create sessions before starting the workflow.",
    buttonLabel: "Open Execution",
    targetTab: "execution",
  });

  assert.deepEqual(resolveWorkflowOverviewCta("running"), {
    title: "Monitor execution",
    detail: "Track sessions, blockers, approvals, and progress from the control plane.",
    buttonLabel: "Open Activity",
    targetTab: "activity",
  });
});

test("canRunWorkflowExecutionSetupActions only allows confirmed workflows", () => {
  assert.equal(canRunWorkflowExecutionSetupActions("draft"), false);
  assert.equal(canRunWorkflowExecutionSetupActions("in_review"), false);
  assert.equal(canRunWorkflowExecutionSetupActions("confirmed"), true);
  assert.equal(canRunWorkflowExecutionSetupActions("running"), false);
});
