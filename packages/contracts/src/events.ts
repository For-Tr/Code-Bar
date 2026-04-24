export type EventEntityType = "task" | "session" | "run" | "worktree" | "approval" | "tool_call";
export type EventSource = "desktop" | "daemon" | "mcp" | "provider" | "launcher";

export interface EventEnvelope {
  id: string;
  entityType: EventEntityType;
  entityId: string;
  eventType: string;
  source: EventSource;
  correlationId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
