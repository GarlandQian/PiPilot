import * as React from 'react'
import { TbLoader2 } from 'react-icons/tb'
import { useT, type MessageKey } from '@/i18n'
import {
  createDefaultWorkspaceAdapter,
  type WorkspaceAdapter,
} from '@/renderer/adapters/workspace-adapter'
import { useWorkspaceStore } from '@/store/workspace'
import type { PiConversationPresentation } from '@/store/pi-rpc'
import type { PiPilotApiError } from '@/shared/pipilot-api'
import type { WorkspacePathSearchEntry } from '@/shared/workspace-content'
import type { FileNode, ToolCall } from '@/types/chat'
import { FileTree } from './FileTree'
import { DiffViewer } from './DiffViewer'
import { ContinuousDiffController } from './continuous-diff-controller'
import { TerminalLoadingFallback } from './TerminalPanel'
import { SubagentExecutionPanel } from './SubagentExecutionPanel'
import { InspectorToolbar, InspectorView, type InspectorTab } from './InspectorView'
import { InspectorFileTabs } from './InspectorFileTabs'
import { InspectorResourcesController, type InspectorPreviewState } from './inspector-resources'
import { replaceFileTreeChildren } from './file-tree-state'

export { INSPECTOR_TABS, isInspectorTab, type InspectorTab } from './InspectorView'
export type { InspectorPreviewState } from './inspector-resources'

const RealTerminalPanel = React.lazy(() =>
  import('./RealTerminalPanel').then((module) => ({
    default: module.RealTerminalPanel,
  })),
)

interface InspectorPanelProps {
  width: number
  visible?: boolean
  onClose?: () => void
  activeTab?: InspectorTab
  onActiveTabChange?: (tab: InspectorTab) => void
  previewState?: InspectorPreviewState | null
  onPreviewStateChange?: (state: InspectorPreviewState | null) => void
  conversation: PiConversationPresentation
  sessionKey: string | null
  onAddWorkspaceReference?: (entry: WorkspacePathSearchEntry) => void
  subagentCall?: ToolCall | null
  onCloseSubagent?: () => void
}

function errorCode(error: unknown) {
  const code = (error as Partial<PiPilotApiError> | null)?.code
  return typeof code === 'string' ? code : 'UNKNOWN_ERROR'
}

function errorMessageKey(code: string): MessageKey {
  if (code === 'WORKSPACE_CHANGE_CONFLICT') return 'inspector.error.conflict'
  if (code === 'WORKSPACE_GIT_UNAVAILABLE') return 'inspector.error.gitUnavailable'
  if (code === 'WORKSPACE_CONTENT_STALE_WORKSPACE') return 'inspector.error.staleWorkspace'
  if (code.startsWith('WORKSPACE_PATH_')) return 'inspector.error.invalidPath'
  return 'inspector.error.generic'
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

function WorkspaceInspectorTabs({
  adapter,
  onAddWorkspaceReference,
  onPreviewStateChange,
  previewState,
  sessionKey,
  tab,
  visible,
  conversation,
  workspaceId,
  workspaceName,
}: {
  adapter: WorkspaceAdapter
  onAddWorkspaceReference?: (entry: WorkspacePathSearchEntry) => void
  onPreviewStateChange?: (state: InspectorPreviewState | null) => void
  previewState?: InspectorPreviewState | null
  sessionKey: string
  tab: InspectorTab
  visible: boolean
  conversation: PiConversationPresentation
  workspaceId: string
  workspaceName: string
}) {
  const t = useT()
  const workspaceStore = useWorkspaceStore()
  const [resources] = React.useState(() => new InspectorResourcesController(
    workspaceId,
    (path) => adapter.files.preview(workspaceId, path),
    previewState,
  ))
  const resourceSnapshot = React.useSyncExternalStore(resources.subscribe, resources.getSnapshot, resources.getSnapshot)
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
  const [diffActivated, setDiffActivated] = React.useState(false)

  const loadDirectory = React.useCallback(async (path: string) => {
    const rootRequest = path === '.'
    const lifecycle = lifecycleEpoch.current
    const epoch = rootRequest ? ++directoryEpoch.current : directoryEpoch.current
    if (rootRequest) setFileListState({ status: 'loading' })
    try {
      const snapshot = await adapter.files.list(workspaceId, path)
      if (
        lifecycle !== lifecycleEpoch.current ||
        epoch !== directoryEpoch.current
      ) return
      const children: FileNode[] = snapshot.entries.map((entry) => ({
        ...entry,
        ...(entry.type === 'dir' ? { loaded: false } : {}),
      }))
      setRoot((previous) => replaceFileTreeChildren(previous, path, children, snapshot.truncated))
      setModifiedCount(snapshot.modifiedCount)
      if (rootRequest) setFileListState({ status: 'ready' })
    } catch (error) {
      if (
        lifecycle !== lifecycleEpoch.current ||
        epoch !== directoryEpoch.current
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
    if (visible && tab === 'diff' && !diffActivated) {
      setDiffActivated(true)
      void loadChanges()
    }
  }, [diffActivated, loadChanges, tab, visible])

  React.useEffect(() => () => {
    lifecycleEpoch.current += 1
    directoryEpoch.current += 1
    resources.dispose()
    diffController.dispose()
  }, [diffController, resources])

  React.useLayoutEffect(() => {
    resources.setSession(conversation.status === 'ready' ? sessionKey : null)
    return () => resources.setSession(null)
  }, [conversation.status, resources, sessionKey])
  React.useEffect(() => {
    if (conversation.status !== 'ready') return
    onPreviewStateChange?.(resourceSnapshot.files.find((file) => file.path === resourceSnapshot.activePath) ?? null)
  }, [conversation.status, onPreviewStateChange, resourceSnapshot])

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
  const blocked = conversation.status === 'ready' ? null : conversation

  return (
    <>
      <InspectorView view="files" activeView={tab}>
        <div hidden={Boolean(blocked)} className="h-full min-h-0">
          <InspectorFileTabs controller={resources} snapshot={resourceSnapshot} errorMessageKey={errorMessageKey} onAddToComposer={onAddWorkspaceReference}>
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
              onSelect={(path) => { if (resources.open(path)) setCurrentPath(path) }}
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
          </InspectorFileTabs>
        </div>
        {blocked ? <SessionOwnedInspectorState conversation={blocked} /> : null}
      </InspectorView>
      <InspectorView view="diff" activeView={tab}>
        <div hidden={Boolean(blocked)} className="h-full min-h-0">
          {diffActivated ? (
            <DiffViewer
              files={diffSnapshot.files}
              listLoading={diffSnapshot.listLoading}
              listTruncated={diffSnapshot.listTruncated}
              listErrorMessage={diffSnapshot.listErrorCode ? t(errorMessageKey(diffSnapshot.listErrorCode)) : undefined}
              emptyMessage={emptyDiffMessage}
              onRefresh={() => void refreshContent().catch(() => undefined)}
              onRequestFile={diffController.request}
              onRetryFile={diffController.request}
            />
          ) : null}
        </div>
        {blocked ? <SessionOwnedInspectorState conversation={blocked} /> : null}
      </InspectorView>
    </>
  )
}

function ElectronInspector({
  width,
  visible = true,
  onClose,
  activeTab,
  onActiveTabChange,
  conversation,
  sessionKey,
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
    visible && activeTab === 'terminal',
  )
  const [workspaceActivated, setWorkspaceActivated] = React.useState(false)
  const renderWorkspace = workspaceActivated || (visible && conversation.status === 'ready')
  React.useEffect(() => {
    if (visible && activeTab === 'terminal') setTerminalActivated(true)
    if (visible && conversation.status === 'ready') setWorkspaceActivated(true)
  }, [activeTab, conversation.status, visible])
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
      <div
        data-inspector-views
        inert={Boolean(subagentCall && onCloseSubagent)}
        aria-hidden={subagentCall && onCloseSubagent ? true : undefined}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <InspectorToolbar activeView={activeTab} onViewChange={onActiveTabChange} onClose={onClose} visible={visible && !subagentCall} />

        {renderWorkspace && adapter ? (
          <WorkspaceInspectorTabs
            key={workspaceId}
            adapter={adapter}
            onAddWorkspaceReference={onAddWorkspaceReference}
            onPreviewStateChange={onPreviewStateChange}
            previewState={previewState}
            sessionKey={sessionKey ?? 'unavailable'}
            tab={activeTab}
            visible={visible && conversation.status === 'ready'}
            conversation={conversation}
            workspaceId={workspaceId}
            workspaceName={workspaceName}
          />
        ) : (
          <>
            <InspectorView view="files" activeView={activeTab}>
              <SessionOwnedInspectorState conversation={blockedConversation} />
            </InspectorView>
            <InspectorView view="diff" activeView={activeTab}>
              <SessionOwnedInspectorState conversation={blockedConversation} />
            </InspectorView>
          </>
        )}

        <InspectorView view="terminal" activeView={activeTab}>
          {terminalActivated && adapter ? (
            <React.Suspense fallback={<TerminalLoadingFallback />}>
              <RealTerminalPanel
                terminalApi={adapter.terminal}
                scope={{ kind: 'project', workspaceId }}
                visible={visible && activeTab === 'terminal' && !subagentCall}
              />
            </React.Suspense>
          ) : null}
        </InspectorView>
      </div>
      {subagentCall && onCloseSubagent ? (
        <SubagentExecutionPanel call={subagentCall} onClose={onCloseSubagent} />
      ) : null}
    </aside>
  )
}

function EmptyElectronInspector({
  width,
  visible = true,
  onClose,
  activeTab,
  onActiveTabChange,
  conversation,
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
    visible && activeTab === 'terminal',
  )
  React.useEffect(() => {
    if (visible && activeTab === 'terminal') setTerminalActivated(true)
  }, [activeTab, visible])
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
      <div
        data-inspector-views
        inert={Boolean(subagentCall && onCloseSubagent)}
        aria-hidden={subagentCall && onCloseSubagent ? true : undefined}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <InspectorToolbar activeView={activeTab} onViewChange={onActiveTabChange} onClose={onClose} visible={visible && !subagentCall} />
        <InspectorView view="files" activeView={activeTab}>
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
        </InspectorView>
        <InspectorView view="diff" activeView={activeTab}>
          {conversation.status === 'ready' ? (
            <DiffViewer
              files={[]}
              emptyMessage={t('inspector.diff.gitUnavailable')}
            />
          ) : (
            <SessionOwnedInspectorState conversation={conversation} />
          )}
        </InspectorView>
        <InspectorView view="terminal" activeView={activeTab}>
          {terminalActivated && adapter ? (
            <React.Suspense fallback={<TerminalLoadingFallback />}>
              <RealTerminalPanel
                terminalApi={adapter.terminal}
                scope={workspaceStore.activeScope}
                visible={visible && activeTab === 'terminal' && !subagentCall}
              />
            </React.Suspense>
          ) : null}
        </InspectorView>
      </div>
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
        key={workspaceStore.workspace.id}
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
