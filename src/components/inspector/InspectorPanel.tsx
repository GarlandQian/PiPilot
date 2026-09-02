import * as React from 'react'
import { TbLoader2 } from 'react-icons/tb'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useT, type MessageKey } from '@/i18n'
import {
  createDefaultWorkspaceAdapter,
  type WorkspaceAdapter,
} from '@/renderer/adapters/workspace-adapter'
import { useWorkspaceStore } from '@/store/workspace'
import type { PiConversationPresentation } from '@/store/pi-rpc'
import type { PiPilotApiError } from '@/shared/pipilot-api'
import type {
  WorkspaceFilePreview,
  WorkspacePathSearchEntry,
} from '@/shared/workspace-content'
import type { ConversationOutlineItem, FileNode, ToolCall } from '@/types/chat'
import { FileTree } from './FileTree'
import { DiffViewer } from './DiffViewer'
import { ConversationOutlinePanel } from './ConversationOutlinePanel'
import { ContinuousDiffController } from './continuous-diff-controller'
import { TerminalLoadingFallback } from './TerminalPanel'
import { WorkspaceFileViewer } from './WorkspaceFileViewer'
import { SubagentExecutionPanel } from './SubagentExecutionPanel'

export const INSPECTOR_TABS = ['files', 'diff', 'outline', 'terminal'] as const
export type InspectorTab = (typeof INSPECTOR_TABS)[number]

/**
 * The file viewer can move between the wide Inspector and the compact detail
 * layer when the window is resized. Keep the loaded preview at the stable App
 * boundary so that responsive re-parenting never flashes the tree or loses the
 * document that the user was reading.
 */
export interface InspectorPreviewState {
  sessionKey: string
  workspaceId: string
  path: string
  preview?: WorkspaceFilePreview
  phase: 'loading' | 'ready' | 'error'
  errorCode?: string
}

export function isInspectorTab(value: string): value is InspectorTab {
  return (INSPECTOR_TABS as readonly string[]).includes(value)
}

const RealTerminalPanel = React.lazy(() =>
  import('./RealTerminalPanel').then((module) => ({
    default: module.RealTerminalPanel,
  })),
)

interface InspectorPanelProps {
  width: number
  activeTab?: InspectorTab
  onActiveTabChange?: (tab: InspectorTab) => void
  previewState?: InspectorPreviewState | null
  onPreviewStateChange?: (state: InspectorPreviewState | null) => void
  conversation: PiConversationPresentation
  outline: readonly ConversationOutlineItem[]
  outlineSessionKey: string | null
  onNavigateOutline: (entryId: string) => void
  onAddWorkspaceReference?: (entry: WorkspacePathSearchEntry) => void
  subagentCall?: ToolCall | null
  onCloseSubagent?: () => void
}

function InspectorTabList() {
  const t = useT()
  return (
    <div className="flex h-9 shrink-0 items-center border-b border-border/60 px-2">
      <TabsList
        variant="line"
        aria-label={t('inspector.title')}
        className="grid h-8 w-full grid-cols-4 gap-0 p-0"
      >
        <TabsTrigger value="files" className="min-w-0 px-1 text-micro">
          <span className="truncate">{t('inspector.tab.files')}</span>
        </TabsTrigger>
        <TabsTrigger value="diff" className="min-w-0 px-1 text-micro">
          <span className="truncate">{t('inspector.tab.diff')}</span>
        </TabsTrigger>
        <TabsTrigger value="outline" className="min-w-0 px-1 text-micro">
          <span className="truncate">{t('inspector.tab.outline')}</span>
        </TabsTrigger>
        <TabsTrigger value="terminal" className="min-w-0 px-1 text-micro">
          <span className="truncate">{t('inspector.tab.terminal')}</span>
        </TabsTrigger>
      </TabsList>
    </div>
  )
}

function errorCode(error: unknown) {
  const code = (error as Partial<PiPilotApiError>).code
  return typeof code === 'string' ? code : 'UNKNOWN_ERROR'
}

function errorMessageKey(code: string): MessageKey {
  if (code === 'WORKSPACE_CHANGE_CONFLICT') return 'inspector.error.conflict'
  if (code === 'WORKSPACE_GIT_UNAVAILABLE') return 'inspector.error.gitUnavailable'
  if (code === 'WORKSPACE_CONTENT_STALE_WORKSPACE') return 'inspector.error.staleWorkspace'
  if (code.startsWith('WORKSPACE_PATH_')) return 'inspector.error.invalidPath'
  return 'inspector.error.generic'
}

function replaceChildren(
  root: FileNode,
  path: string,
  children: FileNode[],
  truncated: boolean,
): FileNode {
  if (path === '.') return { ...root, children, loaded: true, truncated }
  return {
    ...root,
    children: root.children?.map((child) =>
      child.path === path
        ? { ...child, children, loaded: true, truncated }
        : child.type === 'dir'
          ? replaceChildren(child, path, children, truncated)
          : child),
  }
}

function SessionOwnedInspectorState({
  conversation,
}: {
  conversation: Exclude<PiConversationPresentation, { status: 'ready' }>
}) {
  const t = useT()
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-4 text-center text-caption text-muted-foreground">
      {conversation.status === 'loading' ? (
        <div className="flex items-center gap-2" role="status">
          <TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          {t('inspector.session.loading')}
        </div>
      ) : conversation.status === 'error' ? (
        <p className="max-w-full text-destructive" role="alert">
          {conversation.error}
        </p>
      ) : (
        <p>{t('inspector.session.noSession')}</p>
      )}
    </div>
  )
}

function ReadySessionOwnedTabs({
  adapter,
  outline,
  outlineSessionKey,
  onNavigateOutline,
  onAddWorkspaceReference,
  onPreviewStateChange,
  previewState,
  sessionKey,
  tab,
  workspaceId,
  workspaceName,
}: {
  adapter: WorkspaceAdapter
  outline: readonly ConversationOutlineItem[]
  outlineSessionKey: string | null
  onNavigateOutline: (entryId: string) => void
  onAddWorkspaceReference?: (entry: WorkspacePathSearchEntry) => void
  onPreviewStateChange?: (state: InspectorPreviewState | null) => void
  previewState?: InspectorPreviewState | null
  sessionKey: string
  tab: string
  workspaceId: string
  workspaceName: string
}) {
  const t = useT()
  const workspaceStore = useWorkspaceStore()
  const restoredPreview = previewState &&
    previewState.sessionKey === sessionKey &&
    previewState.workspaceId === workspaceId
    ? previewState
    : null
  const restorePreviewOnMount = restoredPreview?.phase === 'loading' &&
    !restoredPreview.preview
  const [root, setRoot] = React.useState<FileNode>({
    name: workspaceName,
    path: '.',
    type: 'dir',
    children: [],
    loaded: true,
  })
  const [fileListState, setFileListState] = React.useState<
    | { status: 'loading' }
    | { status: 'ready' }
    | { status: 'error'; code: string }
  >({ status: 'loading' })
  const [modifiedCount, setModifiedCount] = React.useState(0)
  const [currentPath, setCurrentPath] = React.useState<string>()
  const [fileSearchQuery, setFileSearchQuery] = React.useState('')
  const [previewPath, setPreviewPath] = React.useState<string | undefined>(
    restoredPreview?.path,
  )
  const [preview, setPreview] = React.useState<WorkspaceFilePreview | undefined>(
    restoredPreview?.preview,
  )
  const [previewLoading, setPreviewLoading] = React.useState(
    restoredPreview?.phase === 'loading',
  )
  const [previewErrorCode, setPreviewErrorCode] = React.useState<string | undefined>(
    restoredPreview?.errorCode,
  )
  const [diffController] = React.useState(() => new ContinuousDiffController((path) => {
    return adapter.changes.read(workspaceId, path)
  }))
  const diffSnapshot = React.useSyncExternalStore(
    diffController.subscribe,
    diffController.getSnapshot,
    diffController.getSnapshot,
  )
  const directoryEpoch = React.useRef(0)
  const lifecycleEpoch = React.useRef(0)
  const previewEpoch = React.useRef(0)
  const restoredPreviewHydrationStarted = React.useRef(false)

  const loadDirectory = React.useCallback(async (path: string) => {
    const rootRequest = path === '.'
    const lifecycle = lifecycleEpoch.current
    const epoch = rootRequest ? ++directoryEpoch.current : directoryEpoch.current
    if (rootRequest) setFileListState({ status: 'loading' })
    try {
      const snapshot = await adapter.files.list(workspaceId, path)
      if (
        lifecycle !== lifecycleEpoch.current ||
        (path === '.' && epoch !== directoryEpoch.current)
      ) return
      const children: FileNode[] = snapshot.entries.map((entry) => ({
        ...entry,
        ...(entry.type === 'dir' ? { loaded: false } : {}),
      }))
      setRoot((previous) => replaceChildren(previous, path, children, snapshot.truncated))
      setModifiedCount(snapshot.modifiedCount)
      if (rootRequest) setFileListState({ status: 'ready' })
    } catch (error) {
      if (
        lifecycle !== lifecycleEpoch.current ||
        (path === '.' && epoch !== directoryEpoch.current)
      ) return
      if (rootRequest) {
        setFileListState({ status: 'error', code: errorCode(error) })
        return
      }
      throw error
    }
  }, [adapter, workspaceId])

  const refreshFiles = React.useCallback(async () => {
    await loadDirectory('.')
  }, [loadDirectory])

  const searchFiles = React.useCallback(async (query: string) => {
    const result = await adapter.files.search(workspaceId, query)
    if (result.workspaceId !== workspaceId) {
      throw new Error('The file search result belongs to a stale workspace.')
    }
    return result
  }, [adapter, workspaceId])

  const loadChanges = React.useCallback(async () => {
    const epoch = diffController.beginListLoad()
    try {
      const snapshot = await adapter.changes.list(workspaceId)
      diffController.resolveList(epoch, snapshot)
    } catch (error) {
      diffController.rejectList(epoch, error)
    }
  }, [adapter, diffController, workspaceId])

  React.useEffect(() => {
    void refreshFiles().catch(() => undefined)
  }, [refreshFiles])

  React.useEffect(() => {
    if (tab === 'diff') void loadChanges()
  }, [loadChanges, tab])

  React.useEffect(() => () => {
    lifecycleEpoch.current += 1
    directoryEpoch.current += 1
    previewEpoch.current += 1
    diffController.dispose()
  }, [diffController])

  const openPreview = React.useCallback(async (path: string) => {
    const lifecycle = lifecycleEpoch.current
    const epoch = ++previewEpoch.current
    setCurrentPath(path)
    setPreviewPath(path)
    setPreview(undefined)
    setPreviewErrorCode(undefined)
    setPreviewLoading(true)
    onPreviewStateChange?.({
      sessionKey,
      workspaceId,
      path,
      phase: 'loading',
    })
    try {
      const nextPreview = await adapter.files.preview(workspaceId, path)
      if (
        lifecycle !== lifecycleEpoch.current ||
        epoch !== previewEpoch.current
      ) return
      setPreview(nextPreview)
      onPreviewStateChange?.({
        sessionKey,
        workspaceId,
        path,
        preview: nextPreview,
        phase: 'ready',
      })
    } catch (error) {
      if (
        lifecycle !== lifecycleEpoch.current ||
        epoch !== previewEpoch.current
      ) return
      setPreview(undefined)
      const code = errorCode(error)
      setPreviewErrorCode(code)
      onPreviewStateChange?.({
        sessionKey,
        workspaceId,
        path,
        phase: 'error',
        errorCode: code,
      })
    } finally {
      if (
        lifecycle === lifecycleEpoch.current &&
        epoch === previewEpoch.current
      ) setPreviewLoading(false)
    }
  }, [adapter, onPreviewStateChange, sessionKey, workspaceId])

  const closePreview = React.useCallback(() => {
    previewEpoch.current += 1
    setPreviewPath(undefined)
    setPreview(undefined)
    setPreviewLoading(false)
    setPreviewErrorCode(undefined)
    onPreviewStateChange?.(null)
  }, [onPreviewStateChange])

  React.useEffect(() => {
    if (!restorePreviewOnMount || !previewPath || restoredPreviewHydrationStarted.current) return
    restoredPreviewHydrationStarted.current = true
    void openPreview(previewPath)
  }, [openPreview, previewPath, restorePreviewOnMount])

  const refreshContent = React.useCallback(async () => {
    await Promise.all([
      refreshFiles(),
      loadChanges(),
      workspaceStore.refreshContent(),
    ])
  }, [loadChanges, refreshFiles, workspaceStore])

  const emptyDiffMessage = diffSnapshot.listLoading
    ? t('inspector.diff.loading')
    : diffSnapshot.listErrorCode
      ? t('inspector.diff.loadError')
      : diffSnapshot.gitAvailable
        ? t('inspector.diff.clean')
        : t('inspector.diff.gitUnavailable')

  return (
    <>
      <TabsContent value="files" className="min-h-0 flex-1 data-[state=inactive]:hidden">
        {previewPath ? (
          <WorkspaceFileViewer
            key={previewPath}
            path={previewPath}
            preview={preview}
            loading={previewLoading}
            errorMessage={previewErrorCode
              ? t(errorMessageKey(previewErrorCode))
              : undefined}
            onBack={closePreview}
            onClose={closePreview}
            onRetry={() => void openPreview(previewPath)}
          />
        ) : (
          <FileTree
            root={root}
            workspaceName={workspaceName}
            workingTreeLabel={t('inspector.files.workspaceTree')}
            currentPath={currentPath}
            modifiedCount={modifiedCount}
            onExpand={loadDirectory}
            onRefresh={() => {
              void refreshContent().catch(() => undefined)
            }}
            onSelect={(path) => void openPreview(path)}
            onAddToComposer={onAddWorkspaceReference}
            loading={fileListState.status === 'loading'}
            errorMessage={fileListState.status === 'error'
              ? t(errorMessageKey(fileListState.code))
              : undefined}
            onRetry={() => void refreshFiles()}
            onSearch={searchFiles}
            searchWorkspaceId={workspaceId}
            searchQuery={fileSearchQuery}
            onSearchQueryChange={setFileSearchQuery}
          />
        )}
      </TabsContent>
      <TabsContent value="diff" className="min-h-0 flex-1 data-[state=inactive]:hidden">
        <DiffViewer
          files={diffSnapshot.files}
          listLoading={diffSnapshot.listLoading}
          listTruncated={diffSnapshot.listTruncated}
          emptyMessage={emptyDiffMessage}
          onRefresh={() => void refreshContent().catch(() => undefined)}
          onRequestFile={diffController.request}
          onRetryFile={diffController.request}
        />
      </TabsContent>
      <TabsContent value="outline" className="min-h-0 flex-1 data-[state=inactive]:hidden">
        <ConversationOutlinePanel
          key={outlineSessionKey ?? 'no-session'}
          items={outline}
          onNavigate={onNavigateOutline}
        />
      </TabsContent>

    </>
  )
}

function ElectronInspector({
  width,
  activeTab,
  onActiveTabChange,
  conversation,
  outline,
  outlineSessionKey,
  onNavigateOutline,
  onAddWorkspaceReference,
  onPreviewStateChange,
  previewState,
  workspaceId,
  workspaceName,
  subagentCall,
  onCloseSubagent,
}: InspectorPanelProps & {
  workspaceId: string
  workspaceName: string
  activeTab: InspectorTab
  onActiveTabChange: (tab: InspectorTab) => void
}) {
  const t = useT()
  const [adapter] = React.useState(createDefaultWorkspaceAdapter)
  const [terminalActivated, setTerminalActivated] = React.useState(
    activeTab === 'terminal',
  )
  const blockedConversation: Exclude<PiConversationPresentation, { status: 'ready' }> =
    conversation.status === 'ready'
      ? { status: 'error', error: t('inspector.error.generic') }
      : conversation

  return (
    <aside
      aria-label={t('inspector.title')}
      style={{ width, maxWidth: '100%' }}
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-sidebar"
    >
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (!isInspectorTab(value)) return
          onActiveTabChange(value)
          if (value === 'terminal') setTerminalActivated(true)
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <InspectorTabList />

        {conversation.status === 'ready' && adapter ? (
          <ReadySessionOwnedTabs
            key={`${workspaceId}:${outlineSessionKey ?? conversation.sessionId}`}
            adapter={adapter}
            outline={outline}
            outlineSessionKey={outlineSessionKey}
            onNavigateOutline={onNavigateOutline}
            onAddWorkspaceReference={onAddWorkspaceReference}
            onPreviewStateChange={onPreviewStateChange}
            previewState={previewState}
            sessionKey={outlineSessionKey ?? conversation.sessionId}
            tab={activeTab}
            workspaceId={workspaceId}
            workspaceName={workspaceName}
          />
        ) : (
          <>
            <TabsContent value="files" className="min-h-0 flex-1 data-[state=inactive]:hidden">
              <SessionOwnedInspectorState conversation={blockedConversation} />
            </TabsContent>
            <TabsContent value="diff" className="min-h-0 flex-1 data-[state=inactive]:hidden">
              <SessionOwnedInspectorState conversation={blockedConversation} />
            </TabsContent>
            <TabsContent value="outline" className="min-h-0 flex-1 data-[state=inactive]:hidden">
              <SessionOwnedInspectorState conversation={blockedConversation} />
            </TabsContent>
          </>
        )}

        <TabsContent
          value="terminal"
          forceMount
          className="min-h-0 flex-1 data-[state=inactive]:hidden"
        >
          {terminalActivated && adapter ? (
            <React.Suspense fallback={<TerminalLoadingFallback />}>
              <RealTerminalPanel
                terminalApi={adapter.terminal}
                scope={{ kind: 'project', workspaceId }}
              />
            </React.Suspense>
          ) : null}
        </TabsContent>
      </Tabs>
      {subagentCall && onCloseSubagent ? (
        <SubagentExecutionPanel call={subagentCall} onClose={onCloseSubagent} />
      ) : null}
    </aside>
  )
}

function EmptyElectronInspector({
  width,
  activeTab,
  onActiveTabChange,
  conversation,
  outline,
  outlineSessionKey,
  onNavigateOutline,
  subagentCall,
  onCloseSubagent,
}: InspectorPanelProps & {
  activeTab: InspectorTab
  onActiveTabChange: (tab: InspectorTab) => void
}) {
  const t = useT()
  const workspaceStore = useWorkspaceStore()
  const [adapter] = React.useState(createDefaultWorkspaceAdapter)
  const [terminalActivated, setTerminalActivated] = React.useState(
    activeTab === 'terminal',
  )
  const root: FileNode = {
    name: workspaceStore.activeScope.kind === 'projectless'
      ? t('conversation.projectless')
      : t('sidebar.workspace.none'),
    path: '.',
    type: 'dir',
    children: [],
    loaded: true,
  }
  return (
    <aside
      aria-label={t('inspector.title')}
      style={{ width, maxWidth: '100%' }}
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-sidebar"
    >
      <Tabs
        value={activeTab}
        className="flex min-h-0 flex-1 flex-col"
        onValueChange={(value) => {
          if (!isInspectorTab(value)) return
          onActiveTabChange(value)
          if (value === 'terminal') setTerminalActivated(true)
        }}
      >
        <InspectorTabList />
        <TabsContent value="files" className="min-h-0 flex-1 data-[state=inactive]:hidden">
          {conversation.status === 'ready' ? (
            <FileTree
              root={root}
              workspaceName={root.name}
              modifiedCount={0}
              workingTreeLabel={t('inspector.files.workspaceTree')}
            />
          ) : (
            <SessionOwnedInspectorState conversation={conversation} />
          )}
        </TabsContent>
        <TabsContent value="diff" className="min-h-0 flex-1 data-[state=inactive]:hidden">
          {conversation.status === 'ready' ? (
            <DiffViewer
              files={[]}
              emptyMessage={t('inspector.diff.gitUnavailable')}
            />
          ) : (
            <SessionOwnedInspectorState conversation={conversation} />
          )}
        </TabsContent>
        <TabsContent value="outline" className="min-h-0 flex-1 data-[state=inactive]:hidden">
          {conversation.status === 'ready' ? (
            <ConversationOutlinePanel
              key={outlineSessionKey ?? 'no-session'}
              items={outline}
              onNavigate={onNavigateOutline}
            />
          ) : (
            <SessionOwnedInspectorState conversation={conversation} />
          )}
        </TabsContent>
        <TabsContent
          value="terminal"
          forceMount
          className="min-h-0 flex-1 data-[state=inactive]:hidden"
        >
          {terminalActivated && adapter ? (
            <React.Suspense fallback={<TerminalLoadingFallback />}>
              <RealTerminalPanel
                terminalApi={adapter.terminal}
                scope={workspaceStore.activeScope}
              />
            </React.Suspense>
          ) : null}
        </TabsContent>
      </Tabs>
      {subagentCall && onCloseSubagent ? (
        <SubagentExecutionPanel call={subagentCall} onClose={onCloseSubagent} />
      ) : null}
    </aside>
  )
}

export function InspectorPanel(props: InspectorPanelProps) {
  const workspaceStore = useWorkspaceStore()
  const [internalTab, setInternalTab] = React.useState<InspectorTab>('files')
  const activeTab = props.activeTab ?? internalTab
  const onActiveTabChange = React.useCallback((tab: InspectorTab) => {
    if (props.activeTab === undefined) setInternalTab(tab)
    props.onActiveTabChange?.(tab)
  }, [props.activeTab, props.onActiveTabChange])
  if (workspaceStore.mode === 'electron' && workspaceStore.workspace?.available) {
    return (
      <ElectronInspector
        {...props}
        activeTab={activeTab}
        onActiveTabChange={onActiveTabChange}
        workspaceId={workspaceStore.workspace.id}
        workspaceName={workspaceStore.workspace.name}
      />
    )
  }
  return (
    <EmptyElectronInspector
      {...props}
      activeTab={activeTab}
      onActiveTabChange={onActiveTabChange}
    />
  )
}
