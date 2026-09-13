import { randomUUID } from 'node:crypto'
import { app, shell, type BrowserWindow } from 'electron'
import {
  appGetInfoContract,
  appShutdownRespondContract,
  ipcChannels,
  settingsChangedEventSchema,
  settingsGetContract,
  settingsResetContract,
  settingsUpdateContract,
  shellOpenExternalContract,
  windowGetStateContract,
  type AppInfo,
} from '../../shared/ipc/contracts'
import type { SettingsRepository } from '../repositories/settings-repository'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import type { ConfigurationShutdownGuard } from '../application-update/configuration-shutdown-guard'
import {
  createTrustedSenderValidator,
  MainProcessError,
  registerValidatedHandler,
} from './validated-handler'

interface RegisterAppIpcOptions {
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
  settingsRepository: SettingsRepository
  shutdownGuard: ConfigurationShutdownGuard
}

export function registerAppIpc({
  getMainWindow,
  policy,
  settingsRepository,
  shutdownGuard,
}: RegisterAppIpcOptions) {
  const isTrustedSender = createTrustedSenderValidator(policy, getMainWindow)

  registerValidatedHandler(appShutdownRespondContract, isTrustedSender, ({ shutdownId, decision }, event) => ({
    accepted: shutdownGuard.respond(event.sender, shutdownId, decision),
  }))

  registerValidatedHandler(appGetInfoContract, isTrustedSender, () => {
    const info: AppInfo = {
      name: 'PiPilot',
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
      mode: app.isPackaged ? 'production' : 'development',
    }
    return info
  })

  registerValidatedHandler(windowGetStateContract, isTrustedSender, () => {
    const window = getMainWindow()
    if (!window || window.isDestroyed()) {
      throw new MainProcessError('WINDOW_UNAVAILABLE', 'The main window is unavailable.')
    }

    return {
      focused: window.isFocused(),
      fullScreen: window.isFullScreen(),
      maximized: window.isMaximized(),
    }
  })

  registerValidatedHandler(
    settingsGetContract,
    isTrustedSender,
    () => settingsRepository.initialize(),
  )

  registerValidatedHandler(settingsUpdateContract, isTrustedSender, async ({ patch }) => {
    const snapshot = settingsRepository.update(patch)
    try {
      return await settingsRepository.whenPersisted(snapshot.revision)
    } catch {
      throw new MainProcessError('SETTINGS_WRITE_FAILED', 'Settings could not be saved. The previous saved settings were restored.')
    }
  })

  registerValidatedHandler(settingsResetContract, isTrustedSender, async ({ scope }) => {
    const snapshot = settingsRepository.reset(scope)
    try {
      return await settingsRepository.whenPersisted(snapshot.revision)
    } catch {
      throw new MainProcessError('SETTINGS_WRITE_FAILED', 'Settings could not be saved. The previous saved settings were restored.')
    }
  })

  settingsRepository.subscribe((snapshot) => {
    const window = getMainWindow()
    if (!window || window.isDestroyed()) return

    const event = settingsChangedEventSchema.parse({
      eventId: randomUUID(),
      snapshot,
    })
    window.webContents.send(ipcChannels.settingsChanged, event)
  })

  registerValidatedHandler(shellOpenExternalContract, isTrustedSender, async ({ url }) => {
    if (!policy.isSafeExternalUrl(url)) {
      throw new MainProcessError(
        'INVALID_EXTERNAL_URL',
        'Only validated HTTP and HTTPS URLs can be opened.',
        false,
      )
    }

    await shell.openExternal(url)
    return { opened: true as const }
  })
}
