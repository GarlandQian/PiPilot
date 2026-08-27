import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppError, IpcContract, RequestContext, SettingsSnapshot } from '../shared/ipc/contracts'
import {
  externalControlSettingsChangedEventSchema,
} from '../shared/external-control'
import {
  appGetInfoContract,
  applicationUpdateChangedEventSchema,
  applicationUpdateCheckContract,
  applicationUpdateDownloadContract,
  applicationUpdateGetContract,
  applicationUpdateInstallContract,
  conversationNavigationChangedEventSchema,
  conversationNavigationGetContract,
  conversationNewContract,
  externalControlGetContract,
  externalControlLauncherGetContract,
  externalControlLauncherInstallContract,
  externalControlLauncherUninstallContract,
  externalControlSetEnabledContract,
  ipcChannels,
  localPiCommandContract,
  localPiExtensionUiEventSchema,
  localPiExtensionUiRespondContract,
  localPiRendererReadyContract,
  localPiRpcEventMessageSchema,
  localPiRuntimeChangedEventSchema,
  localPiRuntimeRestartContract,
  localPiRuntimeStatusContract,
  mcpConfigLoadContract,
  mcpConfigRestartContract,
  mcpConfigSaveContract,
  modelsConfigGetDefaultsContract,
  modelsConfigLoadContract,
  modelsConfigSaveAndRestartContract,
  modelsConfigSaveContract,
  modelsConfigSetDefaultContract,
  modelsConfigTestContract,
  piIntegrationOperationEventSchema,
  piIntegrationsCheckUpdatesContract,
  piIntegrationsInstallContract,
  piIntegrationsLoadContract,
  piIntegrationsRemoveContract,
  piIntegrationsRestartContract,
  piIntegrationsSetRetryContract,
  piIntegrationsUpdateContract,
  sessionCatalogDeleteContract,
  sessionCatalogListContract,
  sessionCatalogOpenContract,
  sessionCatalogRenameContract,
  sessionCatalogRefreshContract,
  settingsChangedEventSchema,
  settingsGetContract,
  settingsResetContract,
  settingsUpdateContract,
  shellOpenExternalContract,
  terminalCreateContract,
  terminalEventSchema,
  terminalInputContract,
  terminalKillContract,
  terminalResizeContract,
  workspaceChangedEventSchema,
  workspaceChooseContract,
  workspaceDiffListContract,
  workspaceDiffReadContract,
  workspaceFilePreviewContract,
  workspaceFilesListContract,
  workspaceFilesSearchContract,
  workspaceGetContract,
  workspaceOpenContract,
  workspaceRemoveContract,
  workspaceSetPinnedContract,
  windowGetStateContract,
} from '../shared/ipc/contracts'
import type { PiPilotApi, PiPilotApiError } from '../shared/pipilot-api'
import type { ConversationScope, SessionCatalogCursor, SessionCatalogSelectionToken } from '../shared/conversation-scope'
import type { LocalPiExtensionUiResponse, LocalPiRendererRpcCommand } from '../shared/local-pi'
import type { ApplicationUpdateSnapshot } from '../shared/application-update'

function createContext(): RequestContext {
  return { requestId: crypto.randomUUID() }
}

function throwBridgeError(error: AppError): never {
  const bridgeError: PiPilotApiError = Object.freeze({ name: 'PiPilotApiError', ...error })
  throw bridgeError
}

async function invoke<TRequest extends { context: RequestContext }, TResponse>(
  contract: IpcContract<TRequest, TResponse>,
  request: TRequest,
): Promise<TResponse> {
  const parsedRequest = contract.requestSchema.safeParse(request)
  if (!parsedRequest.success) {
    throwBridgeError({ code: 'IPC_INVALID_REQUEST', message: 'The IPC request is invalid.', recoverable: true, source: 'preload', requestId: request.context.requestId })
  }
  const rawResult: unknown = await ipcRenderer.invoke(contract.channel, parsedRequest.data)
  const resultValidation = contract.resultSchema.safeParse(rawResult)
  if (!resultValidation.success) {
    throwBridgeError({ code: 'IPC_INVALID_RESULT', message: 'The IPC result is invalid.', recoverable: false, source: 'preload', requestId: parsedRequest.data.context.requestId })
  }
  const result = resultValidation.data
  if (result.requestId !== parsedRequest.data.context.requestId) {
    throwBridgeError({ code: 'IPC_CORRELATION_FAILED', message: 'The IPC response could not be correlated.', recoverable: false, source: 'preload', requestId: parsedRequest.data.context.requestId })
  }
  if (!result.ok) throwBridgeError(result.error)
  return result.value
}

function createSubscription<T>(
  channel: string,
  parse: (value: unknown) => T | undefined,
  listenerGuard?: (value: T) => T,
) {
  const listeners = new Set<(value: T) => void>()
  const handler = (_event: IpcRendererEvent, raw: unknown) => {
    const value = parse(raw)
    if (value === undefined) return
    for (const listener of listeners) {
      try { listener(listenerGuard ? listenerGuard(value) : value) } catch { /* isolate renderer callbacks */ }
    }
  }
  return {
    subscribe(listener: (value: T) => void) {
      if (listeners.size === 0) ipcRenderer.on(channel, handler)
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) ipcRenderer.removeListener(channel, handler)
      }
    },
  }
}

type SettingsListener = (snapshot: SettingsSnapshot) => void
const settingsSubscription = createSubscription(
  ipcChannels.settingsChanged,
  (raw) => {
    const result = settingsChangedEventSchema.safeParse(raw)
    return result.success ? result.data.snapshot : undefined
  },
)
const navigationSubscription = createSubscription(
  ipcChannels.conversationNavigationChanged,
  (raw) => {
    const result = conversationNavigationChangedEventSchema.safeParse(raw)
    return result.success ? result.data.snapshot : undefined
  },
)
const runtimeSubscription = createSubscription(
  ipcChannels.localPiRuntimeChanged,
  (raw) => {
    const result = localPiRuntimeChangedEventSchema.safeParse(raw)
    return result.success ? result.data : undefined
  },
)
const rpcEventSubscription = createSubscription(
  ipcChannels.localPiRpcEvent,
  (raw) => {
    const result = localPiRpcEventMessageSchema.safeParse(raw)
    return result.success ? result.data : undefined
  },
)
const extensionSubscription = createSubscription(
  ipcChannels.localPiExtensionUiRequest,
  (raw) => {
    const result = localPiExtensionUiEventSchema.safeParse(raw)
    return result.success ? result.data : undefined
  },
)
const workspaceSubscription = createSubscription(
  ipcChannels.workspaceChanged,
  (raw) => {
    const result = workspaceChangedEventSchema.safeParse(raw)
    return result.success ? result.data.snapshot : undefined
  },
)
const terminalSubscription = createSubscription(
  ipcChannels.terminalEvent,
  (raw) => {
    const result = terminalEventSchema.safeParse(raw)
    return result.success ? result.data : undefined
  },
)
const piIntegrationsSubscription = createSubscription(
  ipcChannels.piIntegrationsOperation,
  (raw) => {
    const result = piIntegrationOperationEventSchema.safeParse(raw)
    return result.success ? result.data.operation : undefined
  },
)
const applicationUpdateSubscription = createSubscription(
  ipcChannels.applicationUpdateChanged,
  (raw): ApplicationUpdateSnapshot | undefined => {
    const result = applicationUpdateChangedEventSchema.safeParse(raw)
    return result.success ? result.data.snapshot : undefined
  },
)
const externalControlSubscription = createSubscription(
  ipcChannels.externalControlChanged,
  (raw) => {
    const result = externalControlSettingsChangedEventSchema.safeParse(raw)
    return result.success ? result.data.snapshot : undefined
  },
)

const api: PiPilotApi = {
  externalControl: {
    get: () => invoke(externalControlGetContract, { context: createContext() }),
    getLauncher: () => invoke(externalControlLauncherGetContract, {
      context: createContext(),
    }),
    installLauncher: () => invoke(externalControlLauncherInstallContract, {
      context: createContext(),
    }),
    uninstallLauncher: () => invoke(externalControlLauncherUninstallContract, {
      context: createContext(),
    }),
    setEnabled: (enabled) => invoke(externalControlSetEnabledContract, {
      context: createContext(),
      enabled,
    }),
    subscribe: externalControlSubscription.subscribe,
  },
  applicationUpdate: {
    get: () => invoke(applicationUpdateGetContract, { context: createContext() }),
    check: () => invoke(applicationUpdateCheckContract, { context: createContext() }),
    download: () => invoke(applicationUpdateDownloadContract, { context: createContext() }),
    install: (confirmActiveWork = false) => invoke(applicationUpdateInstallContract, { context: createContext(), confirmActiveWork }),
    subscribe: applicationUpdateSubscription.subscribe,
  },
  piIntegrations: {
    checkUpdates: (scope) => invoke(piIntegrationsCheckUpdatesContract, { context: createContext(), scope }),
    install: (scope, source) => invoke(piIntegrationsInstallContract, { context: createContext(), scope, source }),
    load: (scope) => invoke(piIntegrationsLoadContract, { context: createContext(), scope }),
    remove: (scope, source) => invoke(piIntegrationsRemoveContract, { context: createContext(), scope, source }),
    restart: (scope) => invoke(piIntegrationsRestartContract, { context: createContext(), scope }),
    setRetryEnabled: (scope, enabled) => invoke(piIntegrationsSetRetryContract, { context: createContext(), scope, enabled }),
    subscribe: piIntegrationsSubscription.subscribe,
    update: (scope, source) => invoke(piIntegrationsUpdateContract, { context: createContext(), scope, source }),
  },
  mcpConfig: {
    load: (target) => invoke(mcpConfigLoadContract, { context: createContext(), target }),
    restart: () => invoke(mcpConfigRestartContract, { context: createContext() }),
    save: (target, content, expectedFingerprint, restart = true) => invoke(mcpConfigSaveContract, { context: createContext(), target, content, expectedFingerprint, restart }),
  },
  modelsConfig: {
    getDefaults: (target) => invoke(modelsConfigGetDefaultsContract, { context: createContext(), target }),
    load: (target) => invoke(modelsConfigLoadContract, { context: createContext(), target }),
    save: (target, content, expectedFingerprint) => invoke(modelsConfigSaveContract, { context: createContext(), target, content, expectedFingerprint }),
    saveAndRestart: (target, content, expectedFingerprint) => invoke(modelsConfigSaveAndRestartContract, { context: createContext(), target, content, expectedFingerprint }),
    setDefault: (providerId, modelId) => invoke(modelsConfigSetDefaultContract, { context: createContext(), providerId, modelId }),
    test: (target, content, providerId, modelId) => invoke(modelsConfigTestContract, { context: createContext(), target, content, providerId, modelId }),
  },
  conversation: {
    get: () => invoke(conversationNavigationGetContract, { context: createContext() }),
    new: (scope) => invoke(conversationNewContract, { context: createContext(), scope }),
    subscribe: navigationSubscription.subscribe,
  },
  localPi: {
    runtime: {
      command: (command: LocalPiRendererRpcCommand) => invoke(localPiCommandContract, { context: createContext(), command }),
      rendererReady: async () => { await invoke(localPiRendererReadyContract, { context: createContext() }) },
      restart: () => invoke(localPiRuntimeRestartContract, { context: createContext() }),
      respondToExtensionUi: async (generation: number, response: LocalPiExtensionUiResponse) => { await invoke(localPiExtensionUiRespondContract, { context: createContext(), generation, response }) },
      status: () => invoke(localPiRuntimeStatusContract, { context: createContext() }),
      subscribe: runtimeSubscription.subscribe,
      subscribeEvents: rpcEventSubscription.subscribe,
      subscribeExtensionUi: extensionSubscription.subscribe,
    },
  },
  sessionCatalog: {
    delete: (scope: ConversationScope, selectionToken: SessionCatalogSelectionToken) => invoke(sessionCatalogDeleteContract, { context: createContext(), scope, selectionToken }),
    list: (scope: ConversationScope, cursor?: SessionCatalogCursor) => invoke(sessionCatalogListContract, { context: createContext(), scope, cursor }),
    open: (scope: ConversationScope, selectionToken: SessionCatalogSelectionToken) => invoke(sessionCatalogOpenContract, { context: createContext(), scope, selectionToken }),
    rename: (scope: ConversationScope, selectionToken: SessionCatalogSelectionToken, name: string) => invoke(sessionCatalogRenameContract, { context: createContext(), scope, selectionToken, name }),
    refresh: (scope: ConversationScope) => invoke(sessionCatalogRefreshContract, { context: createContext(), scope }),
  },
  workspace: {
    choose: () => invoke(workspaceChooseContract, { context: createContext() }),
    get: () => invoke(workspaceGetContract, { context: createContext() }),
    open: (workspaceId) => invoke(workspaceOpenContract, { context: createContext(), workspaceId }),
    remove: (workspaceId) => invoke(workspaceRemoveContract, { context: createContext(), workspaceId }),
    setPinned: (workspaceId, pinned) => invoke(workspaceSetPinnedContract, { context: createContext(), workspaceId, pinned }),
    subscribe: workspaceSubscription.subscribe,
  },
  files: {
    list: (workspaceId, path) => invoke(workspaceFilesListContract, { context: createContext(), workspaceId, path }),
    preview: (workspaceId, path) => invoke(workspaceFilePreviewContract, { context: createContext(), workspaceId, path }),
    search: (workspaceId, query) => invoke(workspaceFilesSearchContract, { context: createContext(), workspaceId, query }),
  },
  changes: {
    list: (workspaceId) => invoke(workspaceDiffListContract, { context: createContext(), workspaceId }),
    read: (workspaceId, path) => invoke(workspaceDiffReadContract, { context: createContext(), workspaceId, path }),
  },
  terminal: {
    create: (scope, cols, rows) => invoke(terminalCreateContract, { context: createContext(), scope, cols, rows }),
    input: (scope, terminalId, data) => invoke(terminalInputContract, { context: createContext(), scope, terminalId, data }),
    kill: (scope, terminalId) => invoke(terminalKillContract, { context: createContext(), scope, terminalId }),
    resize: (scope, terminalId, cols, rows) => invoke(terminalResizeContract, { context: createContext(), scope, terminalId, cols, rows }),
    subscribe: terminalSubscription.subscribe,
  },
  app: { getInfo: () => invoke(appGetInfoContract, { context: createContext() }) },
  shell: { openExternal: async (url) => { await invoke(shellOpenExternalContract, { context: createContext(), url }) } },
  settings: {
    get: () => invoke(settingsGetContract, { context: createContext() }),
    reset: (scope) => invoke(settingsResetContract, { context: createContext(), scope }),
    subscribe: settingsSubscription.subscribe as (listener: SettingsListener) => () => void,
    update: (patch) => invoke(settingsUpdateContract, { context: createContext(), patch }),
  },
  window: { getState: () => invoke(windowGetStateContract, { context: createContext() }) },
}

contextBridge.exposeInMainWorld('pipilot', api)
