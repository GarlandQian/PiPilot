import { piRetrySettingsUpdateSchema, type PiRetrySettingsUpdate } from '../../shared/pi-integrations'

interface SettingsStorage {
  withLock(scope: 'global', update: (current: string | undefined) => string): void
}

let storageModule: Promise<{ FileSettingsStorage: new (cwd: string, agentDir: string) => SettingsStorage }> | undefined

/** Pi exposes no maxRetries setter. Use its own locked storage to preserve concurrent settings writes. */
export async function persistPiRetrySettings(cwd: string, agentDir: string, update: PiRetrySettingsUpdate) {
  const settings = piRetrySettingsUpdateSchema.parse(update)
  storageModule ??= import(/* @vite-ignore */ new URL(
    './core/settings-manager.js', import.meta.resolve('@earendil-works/pi-coding-agent'),
  ).href)
  const { FileSettingsStorage } = await storageModule
  new FileSettingsStorage(cwd, agentDir).withLock('global', (current) => {
    const document: unknown = current === undefined ? {} : JSON.parse(current.replace(/^\uFEFF/u, ''))
    if (!isObject(document) || (document.retry !== undefined && !isObject(document.retry))) {
      throw new Error('Pi retry settings could not be saved because settings.json has an invalid object shape.')
    }
    const retry = isObject(document.retry) ? document.retry : {}
    return `${JSON.stringify({
      ...document,
      retry: { ...retry, enabled: settings.enabled, ...(settings.maxRetries === undefined ? {} : { maxRetries: settings.maxRetries }) },
    }, null, 2)}\n`
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
