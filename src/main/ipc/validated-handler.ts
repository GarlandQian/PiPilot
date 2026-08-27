import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcContract, RequestContext } from '../../shared/ipc/contracts'
import { createValidatedInvokeHandler, type SenderValidator } from './validated-invoke'

interface IpcRequest {
  context: RequestContext
}

const registrations = new Map<string, symbol>()

export function registerValidatedHandler<TRequest extends IpcRequest, TResponse>(
  contract: IpcContract<TRequest, TResponse>,
  isTrustedSender: SenderValidator,
  handler: (request: TRequest, event: IpcMainInvokeEvent) => TResponse | Promise<TResponse>,
) {
  const registration = Symbol(contract.channel)
  ipcMain.removeHandler(contract.channel)
  ipcMain.handle(
    contract.channel,
    createValidatedInvokeHandler(contract, isTrustedSender, handler),
  )
  registrations.set(contract.channel, registration)

  return () => {
    if (registrations.get(contract.channel) !== registration) return false
    registrations.delete(contract.channel)
    ipcMain.removeHandler(contract.channel)
    return true
  }
}

export { createTrustedSenderValidator, MainProcessError } from './validated-invoke'
