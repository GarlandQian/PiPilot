import type { BrowserWindow } from 'electron'
import {
  ipcChannels,
  terminalCreateContract,
  terminalRestartContract,
  terminalListContract,
  terminalListShellProfilesContract,
  terminalAttachContract,
  terminalRenameContract,
  terminalCloseContract,
  terminalClearContract,
  terminalInputContract,
  terminalKillContract,
  terminalResizeContract,
} from '../../shared/ipc/contracts'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import {
  TerminalServiceError,
  type TerminalService,
} from '../terminal/terminal-service'
import {
  createTrustedSenderValidator,
  MainProcessError,
  registerValidatedHandler,
} from './validated-handler'

interface RegisterTerminalIpcOptions {
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
  terminalService: TerminalService
}

function mapTerminalError(error: unknown): never {
  if (error instanceof TerminalServiceError) {
    throw new MainProcessError(error.code, error.message)
  }
  throw new MainProcessError(
    'TERMINAL_OPERATION_FAILED',
    'The terminal operation could not be completed.',
  )
}

export function registerTerminalIpc({
  getMainWindow,
  policy,
  terminalService,
}: RegisterTerminalIpcOptions) {
  const isTrustedSender = createTrustedSenderValidator(policy, getMainWindow)

  registerValidatedHandler(
    terminalListShellProfilesContract,
    isTrustedSender,
    () => terminalService.listShellProfiles().catch(mapTerminalError),
  )
  registerValidatedHandler(
    terminalListContract,
    isTrustedSender,
    ({ scope }) => terminalService.list(scope).catch(mapTerminalError),
  )
  registerValidatedHandler(
    terminalAttachContract,
    isTrustedSender,
    ({ scope, terminalId, cols, rows }) =>
      terminalService.attach(scope, terminalId, cols, rows).catch(mapTerminalError),
  )
  registerValidatedHandler(
    terminalRenameContract,
    isTrustedSender,
    ({ scope, terminalId, title }) =>
      terminalService.rename(scope, terminalId, title).catch(mapTerminalError),
  )
  registerValidatedHandler(
    terminalCloseContract,
    isTrustedSender,
    ({ scope, terminalId }) =>
      terminalService.close(scope, terminalId).catch(mapTerminalError),
  )
  registerValidatedHandler(
    terminalClearContract,
    isTrustedSender,
    ({ scope, terminalId }) =>
      terminalService.clear(scope, terminalId).catch(mapTerminalError),
  )

  registerValidatedHandler(
    terminalCreateContract,
    isTrustedSender,
    ({ scope, cols, rows, shellProfileId }) =>
      terminalService.create(scope, cols, rows, shellProfileId).catch(mapTerminalError),
  )
  registerValidatedHandler(
    terminalInputContract,
    isTrustedSender,
    ({ scope, terminalId, data }) =>
      terminalService.input(scope, terminalId, data).catch(mapTerminalError),
  )
  registerValidatedHandler(
    terminalRestartContract,
    isTrustedSender,
    ({ scope, terminalId, cols, rows }) =>
      terminalService.restart(scope, terminalId, cols, rows).catch(mapTerminalError),
  )
  registerValidatedHandler(
    terminalResizeContract,
    isTrustedSender,
    ({ scope, terminalId, cols, rows }) =>
      terminalService
        .resize(scope, terminalId, cols, rows)
        .catch(mapTerminalError),
  )
  registerValidatedHandler(
    terminalKillContract,
    isTrustedSender,
    ({ scope, terminalId }) =>
      terminalService.kill(scope, terminalId).catch(mapTerminalError),
  )

  terminalService.subscribe((event) => {
    const window = getMainWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(ipcChannels.terminalEvent, event)
  })
}
