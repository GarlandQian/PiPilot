import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import { APP_URL } from '../security/url-policy'
import { installNavigationGuards } from '../security/navigation'
import { installEditableContextMenu } from './editable-context-menu'
import {
  MIN_WINDOW_SIZE,
  normalizeWindowBounds,
  trackWindowState,
  type WindowStateController,
  type WindowStateRepository,
} from './window-state'

/** Keep in sync with the traffic-light gutter in `src/styles/globals.css`. */
const MAC_TRAFFIC_LIGHT_POSITION = { x: 18, y: 19 }

interface CreateMainWindowOptions {
  developmentUrl?: string
  mainOutputDirectory: string
  onHiddenToTray?: () => void
  onWindowCreated?: (window: BrowserWindow) => void
  /** Return true to keep the process alive and hide the window on close. */
  shouldHideOnClose?: () => boolean
  policy: ApplicationUrlPolicy
  stateRepository: WindowStateRepository
}

export interface MainWindowHandle {
  stateController: WindowStateController
  window: BrowserWindow
}

export async function createMainWindow({
  developmentUrl,
  mainOutputDirectory,
  onHiddenToTray,
  onWindowCreated,
  shouldHideOnClose,
  policy,
  stateRepository,
}: CreateMainWindowOptions): Promise<MainWindowHandle> {
  const primaryDisplay = screen.getPrimaryDisplay()
  const otherDisplays = screen
    .getAllDisplays()
    .filter((display) => display.id !== primaryDisplay.id)
  const workAreas = [primaryDisplay, ...otherDisplays].map((display) => display.workArea)
  const savedState = await stateRepository.load()
  const bounds = normalizeWindowBounds(savedState?.bounds ?? null, workAreas)

  const window = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(MIN_WINDOW_SIZE.width, primaryDisplay.workArea.width),
    minHeight: Math.min(MIN_WINDOW_SIZE.height, primaryDisplay.workArea.height),
    show: false,
    title: 'PiPilot',
    ...(process.platform === 'darwin'
      ? {
          // Native macOS chrome: inset traffic lights over a vibrant sidebar.
          // The renderer leaves the sidebar transparent so the material shows through.
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: MAC_TRAFFIC_LIGHT_POSITION,
          vibrancy: 'sidebar' as const,
          visualEffectState: 'followWindow' as const,
          backgroundColor: '#00000000',
        }
      : { backgroundColor: '#1e1e1f' }),
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      enableWebSQL: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      preload: join(mainOutputDirectory, '../preload/index.cjs'),
      safeDialogs: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  })
  onWindowCreated?.(window)

  window.on('close', (event) => {
    if (window.isDestroyed() || !(shouldHideOnClose?.() ?? false)) return
    event.preventDefault()
    window.hide()
    onHiddenToTray?.()
  })

  installNavigationGuards(window, policy)
  installEditableContextMenu(window)
  const stateController = trackWindowState(window, stateRepository)

  window.once('ready-to-show', () => {
    if (savedState?.maximized) window.maximize()
    window.show()
  })

  if (developmentUrl) {
    await window.loadURL(developmentUrl)
  } else {
    await window.loadURL(APP_URL)
  }

  return { stateController, window }
}
