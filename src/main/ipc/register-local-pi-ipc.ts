import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import {
  ipcChannels,
  localPiCommandContract,
  localPiExtensionUiEventSchema,
  localPiExtensionUiRespondContract,
  localPiRendererReadyContract,
  localPiRpcEventMessageSchema,
  localPiRuntimeChangedEventSchema,
  localPiRuntimeRestartContract,
  localPiRuntimeStatusContract,
} from '../../shared/ipc/contracts'
import type { LocalPiExtensionUiRequest } from '../../shared/local-pi'
import type { ConversationContextService } from '../conversations/conversation-context-service'
import {
  OfficialPiSessionActivationError,
  type OfficialPiSessionActivationService,
} from '../conversations/official-pi-session-activation-service'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import type { SettingsRepository } from '../repositories/settings-repository'
import { projectLocalPiRendererRpcResponse } from './projection/pi-rpc-response-projection'
import { LocalPiRendererReadyGate } from './projection/pi-renderer-ready-gate'
import { PiRuntimeFrontendError, type PiRuntimeFrontend } from '../pi-host/pi-runtime-frontend'
import {
  createTrustedSenderValidator,
  MainProcessError,
  registerValidatedHandler,
} from './validated-handler'

interface RegisterLocalPiIpcOptions {
  activationService: OfficialPiSessionActivationService
  contextService: ConversationContextService
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
  runtimeHost: PiRuntimeFrontend
  settingsRepository?: SettingsRepository
}

function mainError(error: unknown) {
  if (error instanceof PiRuntimeFrontendError) {
    return new MainProcessError(error.code, error.message, error.recoverable)
  }
  if (error instanceof OfficialPiSessionActivationError) {
    return new MainProcessError(error.code, error.message)
  }
  return error
}

/**
 * Registers the validated Renderer IPC surface for the embedded Pi runtime.
 *
 * Replaces the removed executable-discovery surface. Main no longer starts Pi
 * at app launch; `rendererReady` starts the primary embedded runtime for the
 * persisted active conversation scope.
 */
export function registerLocalPiIpc(options: RegisterLocalPiIpcOptions) {
  const {
    activationService,
    contextService,
    getMainWindow,
    policy,
    runtimeHost,
  } = options
  const isTrustedSender = createTrustedSenderValidator(policy, getMainWindow)
  let disposed = false
  let eventForwardChain = Promise.resolve()

  const rendererReadyGate = new LocalPiRendererReadyGate(async () => {
    const snapshot = runtimeHost.getSnapshot()
    if (snapshot.state !== 'stopped') return
    await contextService.start()
  })

  const runtimeUnsubscribe = runtimeHost.subscribe((snapshot) => {
    const window = getMainWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(
      ipcChannels.localPiRuntimeChanged,
      localPiRuntimeChangedEventSchema.parse({
        eventId: randomUUID(),
        snapshot,
      }),
    )
  })

  const eventUnsubscribe = runtimeHost.subscribeEvents((
    event,
    generation,
    runtimeId,
  ) => {
    const forward = async () => {
      if (disposed) return
      if (event.type === 'agent_settled' && runtimeId) {
        await activationService
          .onAgentSettled(runtimeId, generation)
          .catch(() => undefined)
      } else if (
        runtimeId &&
        (
          event.type === 'entry_appended' ||
          event.type === 'session_info_changed'
        )
      ) {
        activationService.onSessionCatalogChanged(runtimeId, generation)
      }
      if (disposed) return
      const window = getMainWindow()
      if (!window || window.isDestroyed()) return
      window.webContents.send(
        ipcChannels.localPiRpcEvent,
        localPiRpcEventMessageSchema.parse({
          eventId: randomUUID(),
          generation,
          event,
        }),
      )
    }
    eventForwardChain = eventForwardChain.then(forward, forward).catch(() => undefined)
    return eventForwardChain
  })

  const uiUnsubscribe = runtimeHost.subscribeUiRequests((envelope) => {
    const forward = async () => {
      if (disposed) return
      const window = getMainWindow()
      if (!window || window.isDestroyed()) return
      window.webContents.send(
        ipcChannels.localPiExtensionUiRequest,
        localPiExtensionUiEventSchema.parse({
          eventId: randomUUID(),
          generation: envelope.runtimeGeneration,
          request: envelope.request as unknown as LocalPiExtensionUiRequest,
        }),
      )
    }
    // Runtime events and extension UI share one Host sequence. Preserve that
    // order across IPC; the renderer may still need to hold pre-entry UI until
    // the prompt's authoritative user entry arrives.
    eventForwardChain = eventForwardChain.then(forward, forward).catch(() => undefined)
    return eventForwardChain
  })

  registerValidatedHandler(
    localPiRuntimeStatusContract,
    isTrustedSender,
    () => runtimeHost.getSnapshot(),
  )
  registerValidatedHandler(
    localPiRendererReadyContract,
    isTrustedSender,
    async () => {
      try {
        await rendererReadyGate.signal()
        return { accepted: true as const }
      } catch {
        throw new MainProcessError(
          'LOCAL_PI_INITIALIZATION_FAILED',
          'Local Pi initialization could not be completed.',
        )
      }
    },
  )
  registerValidatedHandler(
    localPiRuntimeRestartContract,
    isTrustedSender,
    async () => {
      try {
        return await runtimeHost.restart()
      } catch (error) {
        throw mainError(error)
      }
    },
  )
  registerValidatedHandler(
    localPiCommandContract,
    isTrustedSender,
    async ({ command }) => {
      try {
        const sourceIdentity = runtimeHost.getActiveRuntimeIdentity()
        const response = await runtimeHost.request(command)
        const resultIdentity = runtimeHost.getActiveRuntimeIdentity()
        await activationService.afterSuccessfulCommand(
          command.type,
          sourceIdentity,
          resultIdentity,
        )
        return projectLocalPiRendererRpcResponse(response)
      } catch (error) {
        throw mainError(error)
      }
    },
  )
  registerValidatedHandler(
    localPiExtensionUiRespondContract,
    isTrustedSender,
    async ({ generation, response }) => {
      try {
        await runtimeHost.respondToExtensionUi(response, generation)
        return { accepted: true as const }
      } catch (error) {
        throw mainError(error)
      }
    },
  )

  return {
    dispose() {
      disposed = true
      runtimeUnsubscribe()
      eventUnsubscribe()
      uiUnsubscribe()
    },
  }
}
