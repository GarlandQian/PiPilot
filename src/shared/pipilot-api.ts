import type { ExternalEditor } from './external-editors'
import type {
  AppError,
  AppInfo,
  AppSettingsPatch,
  SettingsResetScope,
  SettingsSnapshot,
  WorkspaceRemoveResult,
  WindowSnapshot,
  AppCommand,
} from './ipc/contracts'
import type { ConversationImportCommitRequest, ConversationImportPreviewRequest, ConversationImportPreviewResult } from './conversation-import'
import type {
  WorkspaceChooseResult,
  WorkspacePinnedResult,
  WorkspaceSnapshot,
  WorkspaceSwitchResult,
} from './schemas/workspace'
import type {
  WorkspaceChangeStage,
  WorkspaceDiffFile,
  WorkspaceBranchDiffSnapshot,
  WorkspaceDiffSnapshot,
  WorkspaceDirectorySnapshot,
  WorkspaceFilePreview,
  WorkspaceFileMedia,
  WorkspaceExistingFiles,
  WorkspaceCommitList,
  WorkspaceCommitDiffSnapshot,
  WorkspaceDiffSides,
  WorkspaceGitStatus,
  WorkspaceCommitRequest,
  WorkspaceCommitResult,
  WorkspacePathSearchResult,
} from './workspace-content'
import type {
  TerminalActionResult,
  TerminalEvent,
  TerminalResizeResult,
  TerminalSession,
  TerminalShellProfile,
  TerminalShellProfileId,
  TerminalSummary,
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
  ModelsRemoteListResult,
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
import type { ApplicationShutdownDecision, ApplicationShutdownEvent } from './application-shutdown'
import type { TaskNotificationPresentation, TaskNotificationSnapshot } from './task-notifications'
import type { OfficialPiSessionSummary } from './conversation-scope'
import type { ConversationSearchInput, ConversationSearchResult } from './conversation-search'
import type { ConversationExportRequest, ConversationExportResult } from './conversation-export'
import type { ScheduledTaskInput, ScheduledTasksSnapshot, ScheduledTarget } from './scheduled-tasks'

export interface PiPilotApiError extends AppError {
  readonly name: 'PiPilotApiError'
}

export interface PiPilotApi {
  readonly conversationExport: { save(input: ConversationExportRequest): Promise<ConversationExportResult> }
  readonly conversationImport: {
    preview(input: ConversationImportPreviewRequest): Promise<ConversationImportPreviewResult>
    commit(input: ConversationImportCommitRequest): Promise<ConversationActivationResult>
    discard(input: { token: string }): Promise<{ discarded: true }>
  }
  readonly conversationSearch: { find(input: ConversationSearchInput): Promise<ConversationSearchResult> }
  readonly projectWorkflows: import('./project-workflows').ProjectWorkflowsApi
  readonly sideConversations: import('./side-conversations').SideConversationsApi
  readonly scheduledTasks: {
    get(): Promise<ScheduledTasksSnapshot>
    save(task: ScheduledTaskInput): Promise<ScheduledTasksSnapshot>
    remove(id: string): Promise<ScheduledTasksSnapshot>
    setEnabled(id: string, enabled: boolean): Promise<ScheduledTasksSnapshot>
    runNow(id: string): Promise<ScheduledTasksSnapshot>
    listTargets(cursor?: string): Promise<{ conversations: ScheduledTarget[]; nextCursor: string | null; diagnostics: { scope: string; status: 'not_loaded' | 'unavailable' }[] }>
    subscribe(listener: (snapshot: ScheduledTasksSnapshot) => void): () => void
  }
  readonly notifications: {
    get(): Promise<TaskNotificationSnapshot>
    setPresentation(presentation: TaskNotificationPresentation): Promise<TaskNotificationSnapshot>
    markRead(id?: string): Promise<TaskNotificationSnapshot>
    clear(id?: string): Promise<TaskNotificationSnapshot>
    resolveTarget(id: string): Promise<OfficialPiSessionSummary>
    subscribe(listener: (snapshot: TaskNotificationSnapshot) => void): () => void
  }
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
    /** The models an endpoint offers, listed with the key being entered. */
    listRemote(request: { baseUrl: string; api: string; apiKey?: string }): Promise<ModelsRemoteListResult>
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
    /** Shows the project folder in Finder (File Explorer, file manager). */
    reveal(workspaceId: string): Promise<void>
    subscribe(listener: (snapshot: WorkspaceSnapshot) => void): () => void
  }
  readonly files: {
    list(workspaceId: string, path: string): Promise<WorkspaceDirectorySnapshot>
    preview(workspaceId: string, path: string): Promise<WorkspaceFilePreview>
    /** An image or PDF, whole. */
    media(workspaceId: string, path: string): Promise<WorkspaceFileMedia>
    /** Which of these paths are still files (for restoring file tabs). */
    exist(workspaceId: string, paths: readonly string[]): Promise<WorkspaceExistingFiles>
    /** Show a project file in Finder / File Explorer. */
    reveal(workspaceId: string, path: string): Promise<void>
    search(workspaceId: string, query: string): Promise<WorkspacePathSearchResult>
  }
  readonly changes: {
    list(workspaceId: string): Promise<WorkspaceDiffSnapshot>
    /** The branch's work since it left the default branch (read-only). */
    listBranch(workspaceId: string): Promise<WorkspaceBranchDiffSnapshot>
    read(workspaceId: string, path: string, stage?: WorkspaceChangeStage, commit?: string): Promise<WorkspaceDiffFile>
    /** Recent commits, for the Commit scope. */
    listCommits(workspaceId: string): Promise<WorkspaceCommitList>
    /** One commit's files against its parent (read-only). */
    listCommit(workspaceId: string, commit: string): Promise<WorkspaceCommitDiffSnapshot>
    /** Both sides of a reviewed file, for expanding unchanged lines. */
    sides(workspaceId: string, path: string, stage: WorkspaceChangeStage, options?: { commit?: string; previousPath?: string }): Promise<WorkspaceDiffSides>
    /** Branch, upstream and what a commit would include. */
    status(workspaceId: string): Promise<WorkspaceGitStatus>
    /** Commit, then optionally push and open a pull request. */
    commit(workspaceId: string, request: WorkspaceCommitRequest): Promise<WorkspaceCommitResult>
    /** A commit message for what the commit would contain, from the given model. */
    suggestMessage(workspaceId: string, input: { providerId: string; modelId: string; includeUnstaged: boolean; locale: 'zh-CN' | 'en-US' }): Promise<string>
    /** Stage, unstage or discard; returns the refreshed change list. */
    apply(workspaceId: string, action: 'stage' | 'unstage' | 'discard', changes: readonly { path: string; stage: 'staged' | 'unstaged'; revision: string }[]): Promise<WorkspaceDiffSnapshot>
    /** The same, for one hunk of one file. */
    applyHunk(workspaceId: string, action: 'stage' | 'unstage' | 'discard', change: { path: string; stage: 'staged' | 'unstaged'; revision: string }, hunk: number): Promise<WorkspaceDiffSnapshot>
  }
  /** Apps that open project files: detected editors, the default app, the file manager. */
  readonly editors: {
    list(): Promise<ExternalEditor[]>
    open(workspaceId: string, editorId: string, target?: { path?: string; line?: number }): Promise<void>
  }
  readonly terminal: {
    listShellProfiles(): Promise<TerminalShellProfile[]>
    list(scope: ConversationScope): Promise<TerminalSummary[]>
    attach(scope: ConversationScope, terminalId: string, cols: number, rows: number): Promise<TerminalSession>
    rename(scope: ConversationScope, terminalId: string, title: string): Promise<TerminalSummary>
    close(scope: ConversationScope, terminalId: string): Promise<TerminalActionResult>
    clear(scope: ConversationScope, terminalId: string): Promise<TerminalActionResult>
    create(scope: ConversationScope, cols: number, rows: number, shellProfileId?: TerminalShellProfileId): Promise<TerminalSession>
    restart(scope: ConversationScope, terminalId: string, cols: number, rows: number): Promise<TerminalSession>
    input(scope: ConversationScope, terminalId: string, data: string): Promise<TerminalActionResult>
    kill(scope: ConversationScope, terminalId: string): Promise<TerminalActionResult>
    resize(scope: ConversationScope, terminalId: string, cols: number, rows: number): Promise<TerminalResizeResult>
    subscribe(listener: (event: TerminalEvent) => void): () => void
  }
  readonly app: {
    getInfo(): Promise<AppInfo>
    subscribeShutdown(listener: (event: ApplicationShutdownEvent) => void): () => void
    respondToShutdown(shutdownId: string, decision: ApplicationShutdownDecision): Promise<{ accepted: boolean }>
    /** Application-menu commands handled by the renderer (New Task, Settings…). */
    subscribeCommands(listener: (command: AppCommand) => void): () => void
  }
  readonly shell: { openExternal(url: string): Promise<void> }
  readonly settings: {
    getPiDirectory(): Promise<import('./pi-directory').PiDirectorySnapshot>
    choosePiDirectory(): Promise<import('./pi-directory').PiDirectorySnapshot>
    resetPiDirectory(): Promise<import('./pi-directory').PiDirectorySnapshot>
    get(): Promise<SettingsSnapshot>
    reset(scope: SettingsResetScope): Promise<SettingsSnapshot>
    subscribe(listener: (snapshot: SettingsSnapshot) => void): () => void
    update(patch: AppSettingsPatch): Promise<SettingsSnapshot>
  }
  readonly window: {
    getState(): Promise<WindowSnapshot>
    subscribe(listener: (state: WindowSnapshot) => void): () => void
    exitFullScreen(): Promise<WindowSnapshot>
    /** Close the window (⌘W when no tab is left to close). */
    close(): Promise<void>
  }
}
