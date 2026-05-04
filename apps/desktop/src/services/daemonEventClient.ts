import { listen } from "@tauri-apps/api/event"
import type { EventEnvelope } from "@codebar/contracts"

export type DaemonEventListener = (event: EventEnvelope) => void

function isEventEnvelope(value: unknown): value is EventEnvelope {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return typeof record.id === "string"
    && typeof record.entityType === "string"
    && typeof record.entityId === "string"
    && typeof record.eventType === "string"
    && typeof record.source === "string"
    && typeof record.createdAt === "string"
}

export async function subscribeDaemonEvents(listener: DaemonEventListener): Promise<() => void> {
  const unlisten = await listen<unknown>("daemon-event", ({ payload }) => {
    if (!isEventEnvelope(payload)) return
    listener(payload)
  })
  return () => {
    unlisten()
  }
}
