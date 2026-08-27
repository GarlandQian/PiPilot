import type {
  AppError,
  AppInfo,
  AppSettingsPatch,
  SettingsResetScope,
  SettingsSnapshot,
  WorkspaceRemoveResult,
  WindowSnapshot,
} from './ipc/contracts'
import type {
  WorkspaceChooseResult,
  WorkspacePinnedResult,
  WorkspaceSnapshot,
  WorkspaceSwitchResult,
} from './schemas/workspace'
import type {
  WorkspaceDiffFile,
  WorkspaceDiffSnapshot,
  WorkspaceDirectorySnapshot,
  WorkspaceFilePreview,
  WorkspacePathSearchResult,
} from './workspace-content'
import type {
  TerminalActionResult,
  TerminalEvent,
  TerminalResizeResult,
  TerminalSession,
} from './terminal'
import type {
  LocalPiExtensionUiEvent,
  LocalPiExtensionUiResponse,
  LocalPiRendererRpcCommand,
  LocalPiRendererRpcResponse,
  LocalPiRpcEventMessage,
  LocalPiRuntimeChangedEvent,
  LocalPiRuntimeSnapshot,
} from './local-pi'
import type {
  ConversationActivationResult,
  ConversationNavigationSnapshot,
  ConversationScope,
  SessionCatalogCursor,
  SessionCatalogDeleteResult,
  SessionCatalogListResult,
  SessionCatalogRenameResult,
  SessionCatalogSelectionToken,
} from './conversation-scope'
import type {
  McpConfigRestartResult,
  McpConfigSaveResult,
  McpConfigSnapshot,
  McpConfigTarget,
} from './mcp-config'
import type {
  ModelsConfigDefaults,
  ModelsConfigSaveResult,
  ModelsConfigSetDefaultResult,
  ModelsConfigSnapshot,
  ModelsConfigTarget,
  ModelsConfigTestResult,
} from './models-config'
import type {
  PiIntegrationOperation,
  PiIntegrationOperationResult,
  PiIntegrationScope,
  PiIntegrationSnapshot,
} from './pi-integrations'
import type {
  ApplicationUpdateActionResult,
  ApplicationUpdateSnapshot,
} from './application-update'
import type {
  ExternalControlLauncherSnapshot,
  ExternalControlSettingsSnapshot,
} from './external-control'

export interface PiPilotApiError extends AppError {
  readonly name: 'PiPilotApiError'
}

export interface PiPilotApi {
  readonly externalControl: {
    get(): Promise<ExternalControlSettingsSnapshot>
    getLauncher(): Promise<ExternalControlLauncherSnapshot>
    installLauncher(): Promise<ExternalControlLauncherSnapshot>
    uninstallLauncher(): Promise<ExternalControlLauncherSnapshot>
    setEnabled(enabled: boolean): Promise<ExternalControlSettingsSnapshot>
    subscribe(listener: (snapshot: ExternalControlSettingsSnapshot) => void): () => void
  }
  readonly applicationUpdate: {
    get(): Promise<ApplicationUpdateSnapshot>
    check(): Promise<ApplicationUpdateActionResult>
    download(): Promise<ApplicationUpdateActionResult>
    install(confirmActiveWork?: boolean): Promise<ApplicationUpdateActionResult>
    subscribe(listener: (snapshot: ApplicationUpdateSnapshot) => void): () => void
  }
  readonly piIntegrations: {
    checkUpdates(scope: PiIntegrationScope): Promise<PiIntegrationOperationResult>
    install(scope: PiIntegrationScope, source: string): Promise<PiIntegrationOperationResult>
    load(scope: PiIntegrationScope): Promise<PiIntegrationSnapshot>
    remove(scope: PiIntegrationScope, source: string): Promise<PiIntegrationOperationResult>
    restart(scope: PiIntegrationScope): Promise<PiIntegrationOperationResult>
    setRetryEnabled(scope: PiIntegrationScope, enabled: boolean): Promise<PiIntegrationOperationResult>
    subscribe(listener: (operation: PiIntegrationOperation) => void): () => void
    update(scope: PiIntegrationScope, source: string): Promise<PiIntegrationOperationResult>
  }
  readonly mcpConfig: {
    load(target: McpConfigTarget): Promise<McpConfigSnapshot>
    restart(): Promise<McpConfigRestartResult>
    save(target: McpConfigTarget, content: string, expectedFingerprint: string, restart?: boolean): Promise<McpConfigSaveResult>
  }
  readonly modelsConfig: {
    getDefaults(target: ModelsConfigTarget): Promise<ModelsConfigDefaults>
    load(target: ModelsConfigTarget): Promise<ModelsConfigSnapshot>
    save(target: ModelsConfigTarget, content: string, expectedFingerprint: string): Promise<ModelsConfigSaveResult>
    saveAndRestart(target: ModelsConfigTarget, content: string, expectedFingerprint: string): Promise<ModelsConfigSaveResult>
    setDefault(providerId: string, modelId: string): Promise<ModelsConfigSetDefaultResult>
    test(target: ModelsConfigTarget, content: string, providerId: string, modelId: string): Promise<ModelsConfigTestResult>
  }
  readonly conversation: {
    get(): Promise<ConversationNavigationSnapshot>
    readonly 'new': (scope: ConversationScope) => Promise<ConversationActivationResult>
    subscribe(listener: (snapshot: ConversationNavigationSnapshot) => void): () => void
  }
  readonly localPi: {
    runtime: {
      command(command: LocalPiRendererRpcCommand): Promise<LocalPiRendererRpcResponse>
      rendererReady(): Promise<void>
      restart(): Promise<LocalPiRuntimeSnapshot>
      respondToExtensionUi(generation: number, response: LocalPiExtensionUiResponse): Promise<void>
      status(): Promise<LocalPiRuntimeSnapshot>
      subscribe(listener: (event: LocalPiRuntimeChangedEvent) => void): () => void
      subscribeEvents(listener: (event: LocalPiRpcEventMessage) => void): () => void
      subscribeExtensionUi(listener: (event: LocalPiExtensionUiEvent) => void): () => void
    }
  }
  readonly sessionCatalog: {
    delete(scope: ConversationScope, selectionToken: SessionCatalogSelectionToken): Promise<SessionCatalogDeleteResult>
    list(scope: ConversationScope, cursor?: SessionCatalogCursor): Promise<SessionCatalogListResult>
    open(scope: ConversationScope, selectionToken: SessionCatalogSelectionToken): Promise<ConversationActivationResult>
    rename(scope: ConversationScope, selectionToken: SessionCatalogSelectionToken, name: string): Promise<SessionCatalogRenameResult>
    refresh(scope: ConversationScope): Promise<SessionCatalogListResult>
  }
  readonly workspace: {
    choose(): Promise<WorkspaceChooseResult>
    get(): Promise<WorkspaceSnapshot>
    open(workspaceId: string): Promise<WorkspaceSwitchResult>
    remove(workspaceId: string): Promise<WorkspaceRemoveResult>
    setPinned(workspaceId: string, pinned: boolean): Promise<WorkspacePinnedResult>
    subscribe(listener: (snapshot: WorkspaceSnapshot) => void): () => void
  }
  readonly files: {
    list(workspaceId: string, path: string): Promise<WorkspaceDirectorySnapshot>
    preview(workspaceId: string, path: string): Promise<WorkspaceFilePreview>
    search(workspaceId: string, query: string): Promise<WorkspacePathSearchResult>
  }
  readonly changes: {
    list(workspaceId: string): Promise<WorkspaceDiffSnapshot>
    read(workspaceId: string, path: string): Promise<WorkspaceDiffFile>
  }
  readonly terminal: {
    create(scope: ConversationScope, cols: number, rows: number): Promise<TerminalSession>
    input(scope: ConversationScope, terminalId: string, data: string): Promise<TerminalActionResult>
    kill(scope: ConversationScope, terminalId: string): Promise<TerminalActionResult>
    resize(scope: ConversationScope, terminalId: string, cols: number, rows: number): Promise<TerminalResizeResult>
    subscribe(listener: (event: TerminalEvent) => void): () => void
  }
  readonly app: { getInfo(): Promise<AppInfo> }
  readonly shell: { openExternal(url: string): Promise<void> }
  readonly settings: {
    get(): Promise<SettingsSnapshot>
    reset(scope: SettingsResetScope): Promise<SettingsSnapshot>
    subscribe(listener: (snapshot: SettingsSnapshot) => void): () => void
    update(patch: AppSettingsPatch): Promise<SettingsSnapshot>
  }
  readonly window: { getState(): Promise<WindowSnapshot> }
}
