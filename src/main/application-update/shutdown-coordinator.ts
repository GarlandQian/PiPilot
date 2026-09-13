import type { Event as ElectronEvent } from 'electron'
import type { ApplicationShutdownIntent } from '../../shared/application-shutdown'
export type { ApplicationShutdownIntent } from '../../shared/application-shutdown'

export interface ApplicationShutdownCoordinatorOptions {
  confirm(intent: ApplicationShutdownIntent): Promise<boolean>
  cancelConfirmation(): void
  dispose(): Promise<void> | void
  quit(): void
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

  constructor(private readonly options: ApplicationShutdownCoordinatorOptions) {}

  get isFinalizing() {
    return this.finalizing
  }

  get currentIntent() {
    return this.intent
  }

  handleBeforeQuit(event: ElectronEvent) {
    if (this.finalizing) return
    event.preventDefault()
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
      this.finalizing = true
      try {
        await this.options.dispose()
      } catch (error) {
        if (intent === 'install-update') throw error
        // Existing cleanup owners are bounded; normal Quit remains best effort.
      }
      finalAction()
    }).catch((error: unknown) => {
      this.finalizing = false
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
}
