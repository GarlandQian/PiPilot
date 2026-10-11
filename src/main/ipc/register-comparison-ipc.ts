import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { comparisonApplyContract, comparisonChannels, comparisonDiffContract, comparisonListContract, comparisonRemoveContract, comparisonStartContract } from '../../shared/ipc/comparison-contracts'
import { comparisonsChangedEventSchema } from '../../shared/comparisons'
import { ComparisonError, type ComparisonService } from '../comparisons/comparison-service'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import { createTrustedSenderValidator, MainProcessError, registerValidatedHandler } from './validated-handler'

export function registerComparisonIpc({ getMainWindow, policy, service }: {
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
  service: ComparisonService
}) {
  const trusted = createTrustedSenderValidator(policy, getMainWindow)
  const map = async <T>(action: () => T | Promise<T>) => {
    try { return await action() }
    catch (error) {
      if (error instanceof ComparisonError) throw new MainProcessError(error.code, error.message, true)
      throw new MainProcessError('COMPARISON_FAILED', (error instanceof Error ? error.message : 'The comparison failed.').slice(0, 1_000), true)
    }
  }
  const detach = service.subscribe((comparisons) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send(comparisonChannels.changed, comparisonsChangedEventSchema.parse({ eventId: randomUUID(), comparisons }))
  })
  const unregister = [
    registerValidatedHandler(comparisonListContract, trusted, () => map(() => service.list())),
    registerValidatedHandler(comparisonStartContract, trusted, ({ input }) => map(() => service.start(input))),
    registerValidatedHandler(comparisonDiffContract, trusted, ({ id, index }) => map(() => service.diff(id, index))),
    registerValidatedHandler(comparisonApplyContract, trusted, ({ id, index }) => map(() => service.apply(id, index))),
    registerValidatedHandler(comparisonRemoveContract, trusted, ({ id }) => map(async () => { await service.remove(id); return { ok: true as const } })),
  ]
  return { dispose() { detach(); unregister.forEach((stop) => stop()) } }
}
