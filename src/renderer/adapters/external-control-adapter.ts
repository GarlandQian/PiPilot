import type { PiPilotApi } from '@/shared/pipilot-api'

export type ExternalControlAdapter = PiPilotApi['externalControl']

export function createExternalControlAdapter(): ExternalControlAdapter | null {
  return typeof window !== 'undefined' && window.pipilot
    ? window.pipilot.externalControl
    : null
}
