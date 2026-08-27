import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { ipcChannels } from '../../shared/ipc/contracts'
import { applicationUpdateChangedEventSchema } from '../../shared/application-update'
import type { ApplicationUpdateService } from '../application-update/service'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import {
  createTrustedSenderValidator,
  registerValidatedHandler,
} from './validated-handler'
import {
  applicationUpdateCheckContract,
  applicationUpdateDownloadContract,
  applicationUpdateGetContract,
  applicationUpdateInstallContract,
} from '../../shared/ipc/contracts'

export interface RegisterApplicationUpdateIpcOptions {
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
  service: ApplicationUpdateService
}

export function registerApplicationUpdateIpc({
  getMainWindow,
  policy,
  service,
}: RegisterApplicationUpdateIpcOptions) {
  const isTrustedSender = createTrustedSenderValidator(policy, getMainWindow)
  const unsubscribe = service.subscribe((snapshot) => {
    const window = getMainWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(
      ipcChannels.applicationUpdateChanged,
      applicationUpdateChangedEventSchema.parse({
        eventId: randomUUID(),
        snapshot,
      }),
    )
  })

  registerValidatedHandler(applicationUpdateGetContract, isTrustedSender, () => service.getSnapshot())
  registerValidatedHandler(applicationUpdateCheckContract, isTrustedSender, () => service.check())
  registerValidatedHandler(applicationUpdateDownloadContract, isTrustedSender, () => service.download())
  registerValidatedHandler(applicationUpdateInstallContract, isTrustedSender, ({ confirmActiveWork }) => service.install(confirmActiveWork))

  return { dispose: unsubscribe }
}
