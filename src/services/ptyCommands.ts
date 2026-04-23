import { invoke } from "@tauri-apps/api/core";
import { buildRunnerPtyId, buildTerminalPtyId } from "./ptyIdentity";
import { usePtyStore } from "../store/ptyStore";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";

export async function stopPty(ptyId: string) {
  await invoke("stop_pty_session", { ptyId }).catch(() => {});
  usePtyStore.getState().markRuntimeExited(ptyId);
}

export async function listPtys() {
  return invoke<Array<{
    pty_id: string;
    session_id?: string | null;
    kind: string;
    runner_type: string;
    workdir: string;
    created_at_ms: number;
    last_active_at_ms: number;
    status: string;
  }>>("list_pty_sessions");
}

function getTerminalTabKeys(): string[] {
  const items = useSettingsStore.getState().settings.splitWidgetCanvas.items;
  const keys = items.flatMap((item) => (
    item.type === "terminal" ? item.tabs.map((tab) => tab.ptySessionKey) : []
  ));
  return [...new Set(keys)];
}

export function getManagedPtyIdsForSession(sessionId: string): string[] {
  const descriptorIds = usePtyStore.getState().descriptors
    .filter((descriptor) => descriptor.sessionId === sessionId)
    .map((descriptor) => descriptor.ptyId);
  if (descriptorIds.length > 0) {
    return [...new Set(descriptorIds)];
  }
  return [
    buildRunnerPtyId(sessionId),
    ...getTerminalTabKeys().map((tabKey) => buildTerminalPtyId(sessionId, tabKey)),
  ];
}

export async function stopSessionPtys(sessionId: string) {
  const ptyIds = getManagedPtyIdsForSession(sessionId);
  await Promise.allSettled(ptyIds.map((ptyId) => stopPty(ptyId)));
  usePtyStore.getState().removeSessionDescriptors(sessionId);
}

export async function stopTerminalTabPtys(tabKey: string) {
  const descriptorIds = usePtyStore.getState().descriptors
    .filter((descriptor) => descriptor.widgetTabKey === tabKey)
    .map((descriptor) => descriptor.ptyId);
  const ptyIds = descriptorIds.length > 0
    ? descriptorIds
    : useSessionStore.getState().sessions.map((session) => buildTerminalPtyId(session.id, tabKey));
  await Promise.allSettled(ptyIds.map((ptyId) => stopPty(ptyId)));
  usePtyStore.getState().removeTerminalDescriptorsByTabKey(tabKey);
}
