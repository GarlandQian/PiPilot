import { randomUUID } from 'node:crypto'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type {
  AppError,
  IpcContract,
  IpcResult,
  RequestContext,
} from '../../shared/ipc/contracts'
import type { ApplicationUrlPolicy } from '../security/url-policy'

interface IpcRequest {
  context: RequestContext
}

export type SenderValidator = (event: IpcMainInvokeEvent) => boolean

export class MainProcessError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recoverable = true,
  ) {
    super(message)
    this.name = 'MainProcessError'
  }
}

export function createTrustedSenderValidator(
  policy: ApplicationUrlPolicy,
  getMainWindow: () => BrowserWindow | null,
): SenderValidator {
  return (event) => {
    const window = getMainWindow()
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents
    ) {
      return false
    }

    const frame = event.senderFrame
    return (
      frame !== null &&
      frame === event.sender.mainFrame &&
      policy.isTrustedRendererUrl(frame.url)
    )
  }
}

function errorResult(
  requestId: string,
  code: string,
  message: string,
  recoverable: boolean,
): IpcResult<never> {
  const error: AppError = {
    code,
    message,
    recoverable,
    source: 'main',
    requestId,
  }
  return { ok: false, requestId, error }
}

export function createValidatedInvokeHandler<TRequest extends IpcRequest, TResponse>(
  contract: IpcContract<TRequest, TResponse>,
  isTrustedSender: SenderValidator,
  handler: (request: TRequest, event: IpcMainInvokeEvent) => TResponse | Promise<TResponse>,
) {
  return async (
    event: IpcMainInvokeEvent,
    rawRequest: unknown,
  ): Promise<IpcResult<TResponse>> => {
    if (!isTrustedSender(event)) {
      return errorResult(
        randomUUID(),
        'IPC_UNTRUSTED_SENDER',
        'The IPC sender is not trusted.',
        false,
      )
    }

    const requestResult = contract.requestSchema.safeParse(rawRequest)
    if (!requestResult.success) {
      return errorResult(
        randomUUID(),
        'IPC_INVALID_REQUEST',
        'The IPC request is invalid.',
        true,
      )
    }

    const request = requestResult.data
    const requestId = request.context.requestId

    try {
      const rawResponse = await handler(request, event)
      const responseResult = contract.responseSchema.safeParse(rawResponse)
      if (!responseResult.success) {
        console.error(`[PiPilot] Invalid response for ${contract.channel}`)
        return errorResult(
          requestId,
          'IPC_INVALID_RESPONSE',
          'The IPC response is invalid.',
          false,
        )
      }

      return { ok: true, requestId, value: responseResult.data }
    } catch (error) {
      if (error instanceof MainProcessError) {
        return errorResult(requestId, error.code, error.message, error.recoverable)
      }

      console.error(`[PiPilot] IPC handler failed for ${contract.channel}`)
      return errorResult(
        requestId,
        'IPC_INTERNAL_ERROR',
        'The operation could not be completed.',
        true,
      )
    }
  }
}
