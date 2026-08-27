import type { Event as ElectronEvent } from 'electron'

export type ApplicationShutdownIntent = 'quit' | 'install-update'

export interface ApplicationShutdownCoordinatorOptions {
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
  private cleanupPromise: Promise<void> | null = null

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
    void this.request('quit')
  }

  requestInstall(install: () => void) {
    if (this.intent === 'quit') {
      return Promise.reject(new Error('Application quit is already in progress.'))
    }
    if (this.intent === 'install-update' || this.finalizing) return this.cleanupPromise ?? Promise.resolve()
    this.intent = 'install-update'
    this.cleanupPromise = this.disposeThen(() => install(), 'install-update')
    return this.cleanupPromise
  }

  requestQuit() {
    if (this.intent === 'install-update') return this.cleanupPromise ?? Promise.resolve()
    if (this.finalizing) return this.cleanupPromise ?? Promise.resolve()
    this.intent = 'quit'
    this.cleanupPromise = this.disposeThen(() => this.options.quit(), 'quit')
    return this.cleanupPromise
  }

  private async request(intent: ApplicationShutdownIntent) {
    if (intent === 'quit') await this.requestQuit()
  }

  private async disposeThen(
    finalAction: () => void,
    intent: ApplicationShutdownIntent,
  ) {
    if (this.finalizing) return
    this.finalizing = true
    try {
      await this.options.dispose()
    } catch (error) {
      if (intent === 'install-update') {
        this.finalizing = false
        this.intent = null
        this.cleanupPromise = null
        throw error
      }
      // Normal quit still has to terminate if a best-effort cleanup owner
      // unexpectedly rejects. Existing owners use bounded cleanup, but this
      // keeps Electron from being left in a half-quit state.
    } finally {
      if (intent === 'quit' || this.finalizing) finalAction()
    }
  }
}
