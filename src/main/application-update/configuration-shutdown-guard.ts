import { randomUUID } from 'node:crypto'
import type { BrowserWindow, WebContents } from 'electron'
import { applicationShutdownEventSchema, type ApplicationShutdownDecision, type ApplicationShutdownEvent, type ApplicationShutdownIntent } from '../../shared/application-shutdown'
import { ipcChannels } from '../../shared/ipc/contracts'

interface GuardOptions {
  getMainWindow(): BrowserWindow | null
  revealMainWindow(): void
  confirmUnavailable(intent: ApplicationShutdownIntent): Promise<boolean>
  acknowledgementTimeoutMs?: number
}

interface PendingCheck {
  event: ApplicationShutdownEvent
  contents: WebContents
  resolve(ready: boolean): void
  cleanup(): void
  acknowledged: boolean
}

/** Checks the live document owner before any resources are disposed. Missing owners fail closed. */
export class ConfigurationShutdownGuard {
  private pending: PendingCheck | null = null
  private approved: { event: ApplicationShutdownEvent; contents: WebContents } | null = null

  constructor(private readonly options: GuardOptions) {}

  async confirm(intent: ApplicationShutdownIntent): Promise<boolean> {
    const window = this.options.getMainWindow()
    if (window && !window.isDestroyed()) this.options.revealMainWindow()
    const contents = window && !window.isDestroyed() ? window.webContents : null
    if (!contents || contents.isDestroyed() || contents.isCrashed()) {
      return this.options.confirmUnavailable(intent).catch(() => false)
    }
    const event = applicationShutdownEventSchema.parse({ shutdownId: randomUUID(), intent, phase: 'check' })
    return new Promise<boolean>((resolve) => {
      const unavailable = () => {
        if (this.pending?.event.shutdownId !== event.shutdownId) return
        const pending = this.pending
        this.pending = null
        pending.cleanup()
        this.send(contents, { ...event, phase: 'cancel' })
        void this.options.confirmUnavailable(intent).then(resolve, () => resolve(false))
      }
      const timer = setTimeout(() => {
        if (this.pending?.event.shutdownId === event.shutdownId && !this.pending.acknowledged) unavailable()
      }, this.options.acknowledgementTimeoutMs ?? 5_000)
      const navigated = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
        if (details.isMainFrame && !details.isSameDocument) unavailable()
      }
      this.pending = {
        event, contents, resolve, acknowledged: false,
        cleanup: () => {
          clearTimeout(timer)
          contents.removeListener('render-process-gone', unavailable)
          contents.removeListener('destroyed', unavailable)
          contents.removeListener('unresponsive', unavailable)
          contents.removeListener('did-start-navigation', navigated)
        },
      }
      contents.once('render-process-gone', unavailable)
      contents.once('destroyed', unavailable)
      contents.once('unresponsive', unavailable)
      contents.on('did-start-navigation', navigated)
      try { contents.send(ipcChannels.appShutdownRequested, event) } catch { unavailable() }
    })
  }

  respond(contents: WebContents, shutdownId: string, decision: ApplicationShutdownDecision) {
    const pending = this.pending
    if (!pending || pending.contents !== contents || pending.event.shutdownId !== shutdownId) return false
    if (decision === 'pending') {
      pending.acknowledged = true
      return true
    }
    this.finish(decision === 'ready')
    return true
  }

  cancel() {
    this.finish(false)
    if (this.approved) this.send(this.approved.contents, { ...this.approved.event, phase: 'cancel' })
    this.approved = null
  }

  private finish(ready: boolean) {
    const pending = this.pending
    if (!pending) return
    this.pending = null
    pending.cleanup()
    if (ready) this.approved = pending
    else this.send(pending.contents, { ...pending.event, phase: 'cancel' })
    pending.resolve(ready)
  }

  private send(contents: WebContents, event: ApplicationShutdownEvent) {
    if (!contents.isDestroyed()) {
      try { contents.send(ipcChannels.appShutdownRequested, event) } catch { /* unavailable owner stays cancelled */ }
    }
  }
}
