import { invoke } from '@tauri-apps/api/core'

export async function daemonRequest<T = Record<string, unknown>>(method: string, params: Record<string, unknown>) {
  return invoke<T>('daemon_request', { method, params })
}
