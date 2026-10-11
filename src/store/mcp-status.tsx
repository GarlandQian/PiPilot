import * as React from 'react'
import type { LocalPiMcpServerStatus } from '@/shared/local-pi'

/*
 * The active conversation's MCP connections, read from its Pi host. Polled
 * quickly while a server is still connecting, slowly otherwise; the last
 * result per server name also feeds Settings › MCP.
 */

export interface McpStatusSnapshot {
  servers: readonly LocalPiMcpServerStatus[]
  errors: readonly string[]
  /** When the snapshot was read, for "last checked" in Settings. */
  checkedAt: number
}

const FAST = 1_500
const SLOW = 10_000
let last: McpStatusSnapshot | null = null
const listeners = new Set<() => void>()
let version = 0
function publish(next: McpStatusSnapshot | null) {
  last = next
  version += 1
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const getVersion = () => version

async function read(): Promise<McpStatusSnapshot | null> {
  const api = window.pipilot?.localPi.runtime
  if (!api) return null
  const response = await api.command({ type: 'get_mcp_status' }) as { success: boolean; command?: string; data?: { servers: LocalPiMcpServerStatus[]; errors: string[] } }
  if (!response.success || response.command !== 'get_mcp_status' || !response.data) return null
  return { servers: response.data.servers, errors: response.data.errors, checkedAt: Date.now() }
}

/** Polls while `sessionKey` names a ready conversation; null clears it. */
export function useMcpStatus(sessionKey: string | null) {
  React.useSyncExternalStore(subscribe, getVersion)
  React.useEffect(() => {
    if (!sessionKey) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      if (stopped) return
      let next: McpStatusSnapshot | null = null
      try { next = await read() } catch { /* a busy or switching runtime answers next time */ }
      if (stopped) return
      if (next) publish(next)
      const settling = next?.servers.some((server) => server.state === 'connecting' || server.state === 'starting')
      timer = setTimeout(() => { void run() }, document.visibilityState === 'visible' && settling ? FAST : SLOW)
    }
    void run()
    const focus = () => { if (timer) clearTimeout(timer); void run() }
    window.addEventListener('focus', focus)
    return () => { stopped = true; if (timer) clearTimeout(timer); window.removeEventListener('focus', focus) }
  }, [sessionKey])
  return { snapshot: sessionKey ? last : null }
}

/** The last status read for a server, in any conversation, for Settings. */
export function useLastMcpServerStatus() {
  React.useSyncExternalStore(subscribe, getVersion)
  return last
}

export async function refreshMcpStatus() {
  try { const next = await read(); if (next) publish(next) } catch { /* keep the last snapshot */ }
}
