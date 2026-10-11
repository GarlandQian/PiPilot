import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, nativeTheme, type WebContents } from 'electron'
import { popoutChannels } from '../../shared/ipc/popout-contracts'
import { popoutChangedEventSchema, type PopoutSnapshot } from '../../shared/popout'
import { APP_URL, type ApplicationUrlPolicy } from '../security/url-policy'
import { installNavigationGuards } from '../security/navigation'
import { installEditableContextMenu } from './editable-context-menu'

/**
 * Small windows that each show one conversation (Codex's pop-out chat). They
 * load the same renderer in its compact pop-out mode and may only use the
 * pop-out IPC channels, read-only settings and external links.
 */
export class PopoutWindows {
  private readonly windows = new Map<string, BrowserWindow>()

  constructor(private readonly options: {
    policy: ApplicationUrlPolicy
    developmentUrl?: string
    mainOutputDirectory: string
    icon?: string
    onClosed(popoutId: string): void
  }) {}

  /** Shows the pop-out of `popoutId`, creating its window the first time. */
  async show(popoutId: string) {
    const existing = this.windows.get(popoutId)
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore()
      existing.show()
      existing.focus()
      return
    }
    const window = new BrowserWindow({
      width: 480, height: 680, minWidth: 360, minHeight: 420,
      show: false, title: 'PiPilot',
      ...(this.options.icon ? { icon: this.options.icon } : {}),
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1f' : '#ffffff',
      ...(process.platform === 'darwin' ? {} : { autoHideMenuBar: true }),
      webPreferences: {
        allowRunningInsecureContent: false, contextIsolation: true, enableWebSQL: false, experimentalFeatures: false,
        navigateOnDragDrop: false, nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false,
        preload: join(this.options.mainOutputDirectory, '../preload/index.cjs'),
        safeDialogs: true, sandbox: true, webSecurity: true, webviewTag: false,
      },
    })
    this.windows.set(popoutId, window)
    installNavigationGuards(window, this.options.policy)
    installEditableContextMenu(window)
    window.once('ready-to-show', () => window.show())
    window.on('closed', () => {
      this.windows.delete(popoutId)
      this.options.onClosed(popoutId)
    })
    const base = this.options.developmentUrl ?? APP_URL
    const url = new URL(base)
    url.searchParams.set('popout', popoutId)
    await window.loadURL(url.toString())
  }

  /** The pop-out a renderer belongs to, if it is one. */
  idFor(sender: WebContents) {
    for (const [id, window] of this.windows) if (!window.isDestroyed() && window.webContents === sender) return id
    return undefined
  }

  all() {
    return [...this.windows.values()].filter((window) => !window.isDestroyed())
  }

  update(snapshot: PopoutSnapshot) {
    const window = this.windows.get(snapshot.popoutId)
    if (!window || window.isDestroyed()) return
    const title = snapshot.scopeLabel ? `${snapshot.title} — ${snapshot.scopeLabel}` : snapshot.title
    if (window.getTitle() !== title) window.setTitle(title)
    if (window.isAlwaysOnTop() !== snapshot.pinned) window.setAlwaysOnTop(snapshot.pinned, 'floating')
    window.webContents.send(popoutChannels.changed, popoutChangedEventSchema.parse({ eventId: randomUUID(), snapshot }))
  }

  closeAll() {
    for (const window of this.all()) window.close()
  }
}
