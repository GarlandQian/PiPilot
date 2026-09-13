import { vi } from 'vitest'
import type { PiRuntimeControlSummary } from '../../../src/main/pi-host/pi-runtime-frontend'
import type { RuntimeConfigurationAttempt, RuntimeConfigurationIdentity, RuntimeConfigurationResult } from '../../../src/main/pi-host/runtime-configuration'

export class FakeConfigApplyRuntime {
  busy = true
  selectedGeneration = 1
  readonly targets: RuntimeConfigurationIdentity[] = [{
    hostKey: 'host-a', hostEpoch: 1, runtimeId: 'rt_a', generation: 1,
  }]
  readonly listeners = new Set<(summaries: PiRuntimeControlSummary[]) => void>()
  readonly reload = vi.fn(async (_target: RuntimeConfigurationIdentity): Promise<void> => undefined)
  readonly applyConfiguration = vi.fn(async (attempt: RuntimeConfigurationAttempt): Promise<RuntimeConfigurationResult> => {
    const counts = { total: this.targets.length, applied: 0, failed: 0 }
    if (!await attempt.isCurrent()) return { state: 'superseded', ...counts }
    if (this.busy) return { state: 'pending', ...counts }
    for (const target of this.targets) {
      if (attempt.isApplied(target)) {
        counts.applied += 1
        continue
      }
      if (!await attempt.isCurrent()) return { state: 'superseded', ...counts }
      try {
        await this.reload(target)
        target.generation += 1
        if (!await attempt.isCurrent()) return { state: 'superseded', ...counts }
        attempt.didApply(target)
        counts.applied += 1
      } catch {
        counts.failed += 1
        return { state: 'failed', ...counts }
      }
    }
    return { state: 'applied', ...counts }
  })

  subscribeControlRuntimes(listener: (summaries: PiRuntimeControlSummary[]) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emitChange() {
    for (const listener of this.listeners) listener([])
  }
}
