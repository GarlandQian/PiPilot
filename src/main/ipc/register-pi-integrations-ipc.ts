import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import {
  ipcChannels,
  piIntegrationOperationEventSchema,
  piIntegrationsCheckUpdatesContract,
  piIntegrationsInstallContract,
  piIntegrationsLoadContract,
  piIntegrationsRemoveContract,
  piIntegrationsRestartContract,
  piIntegrationsSetRetryContract,
  piIntegrationsUpdateContract,
} from '../../shared/ipc/contracts'
import {
  LocalPiIntegrationError,
  type LocalPiIntegrationService,
} from '../local-pi-management/local-pi-integration-service'
import { LocalPiManagementHostError } from '../local-pi-management/local-pi-management-host'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import {
  createTrustedSenderValidator,
  MainProcessError,
  registerValidatedHandler,
} from './validated-handler'

interface RegisterPiIntegrationsIpcOptions {
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
  service: LocalPiIntegrationService
}

function mapIntegrationError(error: unknown): never {
  if (error instanceof LocalPiIntegrationError) {
    throw new MainProcessError(error.code, error.message, error.recoverable)
  }
  if (error instanceof LocalPiManagementHostError) {
    throw new MainProcessError(error.code, error.message, error.recoverable)
  }
  throw error
}

export function registerPiIntegrationsIpc({
  getMainWindow,
  policy,
  service,
}: RegisterPiIntegrationsIpcOptions) {
  const isTrustedSender = createTrustedSenderValidator(policy, getMainWindow)
  const unsubscribe = service.subscribe((operation) => {
    const window = getMainWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(
      ipcChannels.piIntegrationsOperation,
      piIntegrationOperationEventSchema.parse({
        eventId: randomUUID(),
        operation,
      }),
    )
  })

  registerValidatedHandler(
    piIntegrationsLoadContract,
    isTrustedSender,
    ({ scope }) => service.load(scope).catch(mapIntegrationError),
  )
  registerValidatedHandler(
    piIntegrationsInstallContract,
    isTrustedSender,
    ({ scope, source }) => service.install(scope, source).catch(mapIntegrationError),
  )
  registerValidatedHandler(
    piIntegrationsUpdateContract,
    isTrustedSender,
    ({ scope, source }) => service.update(scope, source).catch(mapIntegrationError),
  )
  registerValidatedHandler(
    piIntegrationsRemoveContract,
    isTrustedSender,
    ({ scope, source }) => service.remove(scope, source).catch(mapIntegrationError),
  )
  registerValidatedHandler(
    piIntegrationsCheckUpdatesContract,
    isTrustedSender,
    ({ scope }) => service.checkUpdates(scope).catch(mapIntegrationError),
  )
  registerValidatedHandler(
    piIntegrationsSetRetryContract,
    isTrustedSender,
    ({ scope, enabled }) => service.setRetryEnabled(scope, enabled).catch(mapIntegrationError),
  )
  registerValidatedHandler(
    piIntegrationsRestartContract,
    isTrustedSender,
    ({ scope }) => service.restart(scope).catch(mapIntegrationError),
  )

  return { dispose: unsubscribe }
}
