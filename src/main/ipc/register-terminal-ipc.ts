import type { BrowserWindow } from 'electron'
import {
  ipcChannels,
  terminalCreateContract,
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
    terminalCreateContract,
    isTrustedSender,
    ({ scope, cols, rows }) =>
      terminalService.create(scope, cols, rows).catch(mapTerminalError),
  )
  registerValidatedHandler(
    terminalInputContract,
    isTrustedSender,
    ({ scope, terminalId, data }) =>
      terminalService.input(scope, terminalId, data).catch(mapTerminalError),
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
