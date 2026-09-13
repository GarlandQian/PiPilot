import type { ModelsConfigTestResult } from '@/shared/models-config'

interface TestIdentity {
  revision: number
  requestId: number
}

export type ModelTestResult =
  | { state: 'success'; latencyMs: number; responsePreview: string }
  | { state: 'error'; message: string }

export type ModelTestState = TestIdentity & ({ state: 'testing' } | ModelTestResult)
export type ModelTestStates = Readonly<Record<string, ModelTestState>>

export function modelTestSuccess(result: ModelsConfigTestResult): ModelTestResult {
  return { state: 'success', latencyMs: result.latencyMs, responsePreview: result.responsePreview }
}

export function settleModelTest(
  states: ModelTestStates,
  key: string,
  identity: TestIdentity,
  currentRevision: number,
  result: ModelTestResult,
): ModelTestStates {
  if (states[key]?.requestId !== identity.requestId) return states
  if (identity.revision !== currentRevision) {
    const next = { ...states }
    delete next[key]
    return next
  }
  return { ...states, [key]: { ...identity, ...result } }
}

export function currentModelTest(states: ModelTestStates, key: string, revision: number) {
  const state = states[key]
  return state?.revision === revision ? state : undefined
}
