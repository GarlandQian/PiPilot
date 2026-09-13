export interface RuntimeConfigurationIdentity {
  hostKey: string
  hostEpoch: number
  runtimeId: string
  generation: number
}

export function runtimeConfigurationKey(identity: RuntimeConfigurationIdentity): string {
  return JSON.stringify([identity.hostKey, identity.hostEpoch, identity.runtimeId])
}

export interface RuntimeConfigurationAttempt {
  cwd?: string
  isCurrent(): Promise<boolean>
  isApplied(identity: RuntimeConfigurationIdentity): boolean
  didApply(identity: RuntimeConfigurationIdentity): void
}

export interface RuntimeConfigurationResult {
  state: 'applied' | 'pending' | 'unavailable' | 'failed' | 'superseded'
  total: number
  applied: number
  failed: number
  reason?: 'interaction-required'
  /** Main-only one-shot wakeup; never part of the Renderer status DTO. */
  retryAfter?: Promise<void>
}
