import type { PiPilotApi } from '@/shared/pipilot-api'

export type ApplicationUpdateAdapter = {
  readonly updates: PiPilotApi['applicationUpdate']
  readonly shell: PiPilotApi['shell']
}

export function createApplicationUpdateAdapter(): ApplicationUpdateAdapter | null {
  if (typeof window === 'undefined' || !window.pipilot) return null
  return {
    updates: window.pipilot.applicationUpdate,
    shell: window.pipilot.shell,
  }
}
