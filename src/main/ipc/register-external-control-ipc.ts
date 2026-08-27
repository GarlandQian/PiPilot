import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import {
  externalControlGetContract,
  externalControlLauncherGetContract,
  externalControlLauncherInstallContract,
  externalControlLauncherUninstallContract,
  externalControlSetEnabledContract,
  ipcChannels,
} from '../../shared/ipc/contracts'
import {
  ExternalControlError,
  externalControlSettingsChangedEventSchema,
} from '../../shared/external-control'
import type { ExternalControlLifecycleService } from '../external-control/lifecycle-service'
import {
  ExternalControlLauncherServiceError,
  type ExternalControlLauncherService,
} from '../external-control/launcher-service'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import {
  createTrustedSenderValidator,
  MainProcessError,
  registerValidatedHandler,
} from './validated-handler'

export interface RegisterExternalControlIpcOptions {
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
  launcherService: ExternalControlLauncherService
  service: ExternalControlLifecycleService
}

function mapExternalControlError(error: unknown): never {
  if (error instanceof ExternalControlLauncherServiceError) {
    throw new MainProcessError(error.code, error.message, true)
  }
  if (error instanceof ExternalControlError) {
    throw new MainProcessError(error.code, error.message, true)
  }
  throw error
}

export function registerExternalControlIpc({
  getMainWindow,
  launcherService,
  policy,
  service,
}: RegisterExternalControlIpcOptions) {
  const isTrustedSender = createTrustedSenderValidator(policy, getMainWindow)
  const unsubscribe = service.subscribe((snapshot) => {
    const window = getMainWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(
      ipcChannels.externalControlChanged,
      externalControlSettingsChangedEventSchema.parse({
        eventId: randomUUID(),
        snapshot,
      }),
    )
  })

  const disposeGet = registerValidatedHandler(
    externalControlGetContract,
    isTrustedSender,
    () => service.getSnapshot(),
  )
  const disposeSetEnabled = registerValidatedHandler(
    externalControlSetEnabledContract,
    isTrustedSender,
    ({ enabled }) => service.setEnabled(enabled).catch(mapExternalControlError),
  )
  const disposeLauncherGet = registerValidatedHandler(
    externalControlLauncherGetContract,
    isTrustedSender,
    () => launcherService.inspect(),
  )
  const disposeLauncherInstall = registerValidatedHandler(
    externalControlLauncherInstallContract,
    isTrustedSender,
    () => {
      try {
        return launcherService.install()
      } catch (error) {
        return mapExternalControlError(error)
      }
    },
  )
  const disposeLauncherUninstall = registerValidatedHandler(
    externalControlLauncherUninstallContract,
    isTrustedSender,
    () => {
      try {
        return launcherService.uninstall()
      } catch (error) {
        return mapExternalControlError(error)
      }
    },
  )

  let disposed = false
  return {
    dispose() {
      if (disposed) return false
      disposed = true
      unsubscribe()
      disposeGet()
      disposeLauncherGet()
      disposeLauncherInstall()
      disposeLauncherUninstall()
      disposeSetEnabled()
      return true
    },
  }
}
