import type { BrowserWindow } from 'electron'
import {
  mcpConfigLoadContract,
  mcpConfigRestartContract,
  mcpConfigSaveContract,
} from '../../shared/ipc/contracts'
import {
  McpConfigError,
  type McpConfigController,
} from '../mcp/mcp-config-service'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import {
  createTrustedSenderValidator,
  MainProcessError,
  registerValidatedHandler,
} from './validated-handler'

interface RegisterMcpConfigIpcOptions {
  controller: McpConfigController
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
}

function mapMcpConfigError(error: unknown): never {
  if (error instanceof McpConfigError) {
    throw new MainProcessError(error.code, error.message)
  }
  throw error
}

export function registerMcpConfigIpc({
  controller,
  getMainWindow,
  policy,
}: RegisterMcpConfigIpcOptions) {
  const isTrustedSender = createTrustedSenderValidator(policy, getMainWindow)
  registerValidatedHandler(
    mcpConfigLoadContract,
    isTrustedSender,
    ({ target }) => controller.load(target).catch(mapMcpConfigError),
  )
  registerValidatedHandler(
    mcpConfigSaveContract,
    isTrustedSender,
    ({ target, content, expectedFingerprint, restart }) =>
      controller
        .save(target, content, expectedFingerprint, restart)
        .catch(mapMcpConfigError),
  )
  registerValidatedHandler(
    mcpConfigRestartContract,
    isTrustedSender,
    () => controller.restart(),
  )
}
