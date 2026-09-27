import type { Event as ElectronEvent } from 'electron'
import type { ApplicationShutdownIntent } from '../../shared/application-shutdown'
export type { ApplicationShutdownIntent } from '../../shared/application-shutdown'

export interface ApplicationShutdownCoordinatorOptions {
  confirm(intent: ApplicationShutdownIntent): Promise<boolean>
  cancelConfirmation(): void
  prepareInstall?(): Promise<void> | void
  dispose(): Promise<void> | void
  quit(): void
  installQuitTimeoutMs?: number
}

/**
 * Serializes the only two terminal application actions. Electron can emit
 * before-quit more than once (and electron-updater emits its own quit event),
 * so the coordinator owns the finalization latch instead of each caller.
 */
export class ApplicationShutdownCoordinator {
  private intent: ApplicationShutdownIntent | null = null
  private finalizing = false
  private shutdownPromise: Promise<void> | null = null
  private updaterQuitRequested: (() => void) | null = null
  private allowQuit = false

  constructor(private readonly options: ApplicationShutdownCoordinatorOptions) {}

  get isFinalizing() {
    return this.finalizing
  }

  get currentIntent() {
    return this.intent
  }

  handleBeforeQuit(event: ElectronEvent) {
    if (this.allowQuit) return
    event.preventDefault()
    if (this.updaterQuitRequested) {
      this.updaterQuitRequested()
      return
    }
    void this.requestQuit()
  }

  requestInstall(install: () => void) {
    if (this.intent === 'quit') {
      return Promise.reject(new Error('Application quit is already in progress.'))
    }
    return this.request('install-update', install)
  }

  requestQuit() {
    return this.request('quit', this.options.quit)
  }

  private request(intent: ApplicationShutdownIntent, finalAction: () => void) {
    if (this.shutdownPromise) return this.shutdownPromise
    if (this.finalizing) return Promise.resolve()
    this.intent = intent
    // Install the latch before a synchronous/reentrant confirmation can run.
    const operation = Promise.resolve().then(async () => {
      if (!await this.options.confirm(intent)) return
      if (intent === 'install-update') {
        // NSIS may terminate the old process if it remains alive too long.
        // Flush data and stop work before launching it, without destroying the
        // application services needed to report a launch failure and retry.
        await this.options.prepareInstall?.()
        // The official updater can reject installation synchronously. Keep
        // services and IPC alive until it actually requests application exit.
        await this.waitForUpdaterQuit(finalAction)
      }
      this.finalizing = true
      try {
        await this.options.dispose()
      } catch {
        // Cleanup owners are bounded. Once an installer is launched, exiting
        // is necessary to release its files even if one cleanup owner fails.
      }
      this.allowQuit = true
      this.options.quit()
    }).catch((error: unknown) => {
      this.finalizing = false
      this.allowQuit = false
      if (intent === 'install-update') throw error
    }).finally(() => {
      if (!this.finalizing) {
        this.options.cancelConfirmation()
        this.intent = null
        this.shutdownPromise = null
      }
    })
    this.shutdownPromise = operation
    return operation
  }

  private async waitForUpdaterQuit(install: () => void) {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        this.updaterQuitRequested = resolve
        timeout = setTimeout(() => reject(new Error('The updater did not request application exit.')), this.options.installQuitTimeoutMs ?? 10_000)
        install()
      })
    } finally {
      clearTimeout(timeout)
      this.updaterQuitRequested = null
    }
  }
}
