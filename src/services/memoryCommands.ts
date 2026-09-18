import { invoke } from "@tauri-apps/api/core";

export interface MemoryConfig {
  enabled: boolean;
  baseUrl: string;
  hasApiKey: boolean;
  autoCollect: boolean;
  llmBaseUrl: string;
  llmModel: string;
  managedLocal: boolean;
}
export interface MemoryContext {
  workspacePath: string;
  sessionId: string;
  runnerType: string;
  worktreePath: string;
  providerSessionId?: string;
}
export interface MemoryStatus {
  pending: number;
  failed: number;
  synced: number;
  sources: number;
  lastError: string | null;
}
export interface MemorySource {
  id: string;
  kind: string;
  locator: string;
  scope: string;
  state: string;
  createdAt: string | number;
  taskId?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}
export interface MemoryResult {
  id: string;
  text: string;
  sourceId?: string;
  scope: string;
  metadata?: Record<string, unknown>;
}
const request = <T>(payload: Record<string, unknown>) => invoke<T>("memory_request", { request: payload });

export const memoryCommands = {
  config: () => request<MemoryConfig>({ op: "config" }),
  configure: (config: Pick<MemoryConfig, "enabled" | "baseUrl" | "autoCollect" | "llmBaseUrl" | "llmModel"> & { apiKey?: string }) => request<MemoryConfig>({ op: "configure", ...config }),
  register: (context: MemoryContext) => request<{ token: string; repoId: string }>({ op: "register", ...context }),
  status: (token: string) => request<MemoryStatus>({ op: "status", token }),
  collect: (token: string) => request<{ queued: number }>({ op: "collect", token }),
  recall: (token: string, query: string) => request<{ results: MemoryResult[] }>({ op: "recall", token, query }),
  sources: (token: string, offset = 0) => request<MemorySource[]>({ op: "sources", token, offset }),
  source: (token: string, sourceId: string) => request<MemorySource>({ op: "source", token, sourceId }),
  promote: (token: string, sourceId: string) => request<{ ok: boolean }>({ op: "promote", token, sourceId }),
  invalidate: (token: string, sourceId: string) => request<{ ok: boolean }>({ op: "invalidate", token, sourceId }),
};
