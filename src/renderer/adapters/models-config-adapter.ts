import type { PiPilotApi } from '@/shared/pipilot-api'

export type ModelsConfigAdapter = PiPilotApi['modelsConfig']

export function createModelsConfigAdapter(): ModelsConfigAdapter | null {
  return typeof window !== 'undefined' && window.pipilot
    ? window.pipilot.modelsConfig
    : null
}
