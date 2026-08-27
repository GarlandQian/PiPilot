import type { PiPilotApi } from '@/shared/pipilot-api'

export type PiIntegrationsAdapter = PiPilotApi['piIntegrations']

export function createPiIntegrationsAdapter(): PiIntegrationsAdapter | null {
  return typeof window !== 'undefined' && window.pipilot
    ? window.pipilot.piIntegrations
    : null
}
