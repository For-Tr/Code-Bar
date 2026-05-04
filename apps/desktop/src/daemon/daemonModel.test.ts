// @ts-ignore test-only Node builtins are available at runtime.
import assert from "node:assert/strict";
// @ts-ignore test-only Node builtins are available at runtime.
import test from "node:test";
import type { EventEnvelope, Session } from "@codebar/contracts";
import { patchSessionFromEvent } from "./daemonModel.ts";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    taskId: "task-1",
    workspaceId: "workspace-1",
    provider: "claude",
    launchMode: "new",
    state: "draft",
    createdAt: "2026-04-24T00:00:00Z",
    updatedAt: "2026-04-24T00:00:00Z",
    ...overrides,
  };
}

function makeEvent(payload: Record<string, unknown>): EventEnvelope {
  return {
    id: "event-1",
    entityType: "session",
    entityId: "session-1",
    eventType: "session.updated",
    source: "daemon",
    payload,
    createdAt: "2026-04-24T00:00:01Z",
  };
}

test("patchSessionFromEvent applies provider changes from session.updated payload", () => {
  const session = makeSession({ provider: "claude", providerSessionId: "provider-old" });
  const next = patchSessionFromEvent(session, makeEvent({
    session: {
      ...session,
      provider: "codex",
      providerSessionId: null,
      launchMode: "new",
      state: "ready",
      updatedAt: "2026-04-24T00:00:02Z",
    },
  }));

  assert.equal(next.provider, "codex");
  assert.equal(next.providerSessionId, undefined);
  assert.equal(next.state, "ready");
  assert.equal(next.updatedAt, "2026-04-24T00:00:02Z");
});

test("patchSessionFromEvent ignores invalid session.updated state payload", () => {
  const session = makeSession({ state: "running" });
  const next = patchSessionFromEvent(session, makeEvent({
    session: {
      state: "not-a-session-state",
      updatedAt: "2026-04-24T00:00:02Z",
    },
  }));

  assert.equal(next.state, "running");
  assert.equal(next.updatedAt, "2026-04-24T00:00:02Z");
});
