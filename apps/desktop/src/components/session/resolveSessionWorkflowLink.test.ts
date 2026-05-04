// @ts-ignore test-only Node builtins are available at runtime.
import assert from "node:assert/strict";
// @ts-ignore test-only Node builtins are available at runtime.
import test from "node:test";
import type { TaskDagDocument } from "@codebar/contracts";
import { resolveSessionWorkflowLink } from "./resolveSessionWorkflowLink.ts";

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
      canResolveApproval: false,
      canAttachSession: true,
      canLaunchSession: true,
      canSendSessionInput: true,
      canSubmitForReview: false,
      canConfirm: false,
      canCreateSession: false,
      canStartWorkflow: false,
    },
    task: {
      id: "task-1",
      title: "Ship workflow redesign",
      prompt: "Redesign workflow",
      status: "active",
      lifecycle: "running",
      workspaceId: "workspace-1",
    },
    plan: {
      id: "plan-1",
      mode: "guided",
      status: "active",
      stepIds: ["step-1"],
    },
    nodes: [
      {
        kind: "step",
        id: "node-step-1",
        stepId: "step-1",
        label: "Implement object-first navigation",
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
    ],
    edges: [],
  };
}

test("resolveSessionWorkflowLink returns the linked step for the current session", () => {
  const link = resolveSessionWorkflowLink({
    sessionId: "session-1",
    taskId: "task-1",
    document: makeDocument(),
  });

  assert.deepEqual(link, {
    taskId: "task-1",
    taskTitle: "Ship workflow redesign",
    lifecycle: "running",
    stepId: "step-1",
    stepLabel: "Implement object-first navigation",
    stepStatus: "running",
  });
});

test("resolveSessionWorkflowLink still returns the workflow even when no step is currently assigned", () => {
  const document = makeDocument();
  const link = resolveSessionWorkflowLink({
    sessionId: "session-9",
    taskId: "task-1",
    document,
  });

  assert.equal(link.taskId, "task-1");
  assert.equal(link.taskTitle, "Ship workflow redesign");
  assert.equal(link.lifecycle, "running");
  assert.equal(link.stepId, null);
  assert.equal(link.stepLabel, null);
  assert.equal(link.stepStatus, null);
});
