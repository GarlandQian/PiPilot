import * as React from 'react'
import { useT, type MessageKey } from '@/i18n'
import { createDefaultWorkspaceAdapter, type WorkspaceAdapter } from '@/renderer/adapters/workspace-adapter'
import { useWorkspaceStore } from '@/store/workspace'
import type { PiConversationPresentation } from '@/store/pi-rpc'
import type { PiPilotApiError } from '@/shared/pipilot-api'
import type { WorkspacePathSearchEntry } from '@/shared/workspace-content'
import type { FileNode, ToolCall } from '@/types/chat'
import { FileTree } from './FileTree'
import { DiffViewer } from './DiffViewer'
import { ContinuousDiffController } from './continuous-diff-controller'
import { SubagentExecutionPanel } from './SubagentExecutionPanel'
import { CommandExecutionPanel } from './CommandExecutionPanel'
import { InspectorToolbar, InspectorView, type InspectorTab } from './InspectorView'
import { InspectorFileTabs } from './InspectorFileTabs'
import { InspectorResourcesController, type InspectorPreviewState } from './inspector-resources'
import { replaceFileTreeChildren } from './file-tree-state'
import { ResourceRefreshLoop } from './resource-refresh-loop'

export { INSPECTOR_TABS, isInspectorTab, type InspectorTab } from './InspectorView'
export type { InspectorPreviewState } from './inspector-resources'

interface InspectorPanelProps {
  width: number | string
  expanded?: boolean
  onExpand?: () => void
  visible?: boolean
  onClose?: () => void
  activeTab?: InspectorTab
  onActiveTabChange?: (tab: InspectorTab) => void
  previewState?: InspectorPreviewState | null
  onPreviewStateChange?: (state: InspectorPreviewState | null) => void
  conversation: PiConversationPresentation
  sessionKey: string | null
  refreshRevision?: number | string
  onAddWorkspaceReference?: (entry: WorkspacePathSearchEntry) => void
  subagentCall?: ToolCall | null
  onCloseSubagent?: () => void
  commandCall?: ToolCall | null
  onCloseCommand?: () => void
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

function WorkspaceInspectorTabs({ adapter, onAddWorkspaceReference, onPreviewStateChange, previewState, sessionKey, tab, onTabChange, visible, workspaceId, workspaceName, refreshRevision }: {
  adapter: WorkspaceAdapter
  onAddWorkspaceReference?: (entry: WorkspacePathSearchEntry) => void
  onPreviewStateChange?: (state: InspectorPreviewState | null) => void
  previewState?: InspectorPreviewState | null
  sessionKey: string | null
  tab: InspectorTab
  onTabChange: (tab: InspectorTab) => void
  visible: boolean
  workspaceId: string
  workspaceName: string
  refreshRevision?: number | string
}) {
  const t = useT()
  const [resources] = React.useState(() => new InspectorResourcesController(workspaceId, (path) => adapter.files.preview(workspaceId, path), previewState))
  const resourceSnapshot = React.useSyncExternalStore(resources.subscribe, resources.getSnapshot, resources.getSnapshot)
  const [diffController] = React.useState(() => {
    const controller = new ContinuousDiffController((path, stage) => adapter.changes.read(workspaceId, path, stage))
    controller.setActive(visible && tab === 'diff' && (typeof document === 'undefined' || document.visibilityState !== 'hidden'))
    return controller
  })
  const diffSnapshot = React.useSyncExternalStore(diffController.subscribe, diffController.getSnapshot, diffController.getSnapshot)
  const [root, setRoot] = React.useState<FileNode>({ name: workspaceName, path: '.', type: 'dir', children: [], loaded: false })
  const [fileListState, setFileListState] = React.useState<{ status: 'loading' | 'ready' } | { status: 'error'; code: string }>({ status: 'loading' })
  const [modifiedCount, setModifiedCount] = React.useState(0)
  const [fileSearchQuery, setFileSearchQuery] = React.useState('')
  const [currentPath, setCurrentPath] = React.useState<string>()
  const [diffFocus, setDiffFocus] = React.useState<{ path: string; sequence: number } | null>(null)
  const focusSequence = React.useRef(0)
  const lifecycle = React.useRef(0)
  const rootLoaded = React.useRef(false)
  const directoryReads = React.useRef(new Map<string, Promise<void>>())
  const expandedDirectories = React.useRef(new Set<string>())
  const diffRead = React.useRef<Promise<void> | null>(null)
  const activeTab = React.useRef(tab)
  const diffVisible = React.useRef(visible && tab === 'diff')
  activeTab.current = tab
  diffVisible.current = visible && tab === 'diff'

  const loadDirectory = React.useCallback((path: string): Promise<void> => {
    const pending = directoryReads.current.get(path)
    if (pending) return pending
    const epoch = lifecycle.current
    if (path === '.' && !rootLoaded.current) setFileListState({ status: 'loading' })
    const operation = adapter.files.list(workspaceId, path).then((snapshot) => {
      if (epoch !== lifecycle.current) return
      if (snapshot.workspaceId !== workspaceId || snapshot.path !== path) throw { code: 'WORKSPACE_CONTENT_STALE_WORKSPACE' }
      const children: FileNode[] = snapshot.entries.map((entry) => ({ ...entry, ...(entry.type === 'dir' ? { loaded: false } : {}) }))
      setRoot((previous) => replaceFileTreeChildren(previous, path, children, snapshot.truncated, false))
      setModifiedCount(snapshot.modifiedCount)
      if (path === '.') {
        rootLoaded.current = true
        setFileListState({ status: 'ready' })
      }
    }).catch((error) => {
      if (epoch !== lifecycle.current) return
      if (path === '.') setFileListState({ status: 'error', code: errorCode(error) })
      else throw error
    }).finally(() => {
      if (directoryReads.current.get(path) === operation) directoryReads.current.delete(path)
    })
    directoryReads.current.set(path, operation)
    return operation
  }, [adapter, workspaceId])

  const loadChanges = React.useCallback((): Promise<void> => {
    if (diffRead.current) return diffRead.current
    const epoch = diffController.beginListLoad()
    const operation = adapter.changes.list(workspaceId).then((snapshot) => {
      if (snapshot.workspaceId !== workspaceId) throw { code: 'WORKSPACE_CONTENT_STALE_WORKSPACE' }
      diffController.resolveList(epoch, snapshot, diffVisible.current && document.visibilityState !== 'hidden')
    }).catch((error) => { diffController.rejectList(epoch, error) }).finally(() => {
      if (diffRead.current === operation) diffRead.current = null
    })
    diffRead.current = operation
    return operation
  }, [adapter, diffController, workspaceId])

  const refreshContent = React.useCallback(async () => {
    await Promise.allSettled([
      loadChanges(),
      ...(activeTab.current === 'files'
        ? [loadDirectory('.'), ...[...expandedDirectories.current].map(loadDirectory), resources.refreshActive()]
        : []),
    ])
  }, [loadChanges, loadDirectory, resources])
  const refreshOperation = React.useRef(refreshContent)
  refreshOperation.current = refreshContent
  const [refreshLoop] = React.useState(() => new ResourceRefreshLoop(() => refreshOperation.current()))

  React.useLayoutEffect(() => {
    diffController.setActive(visible && tab === 'diff' && document.visibilityState !== 'hidden')
    return () => diffController.setActive(false)
  }, [diffController, tab, visible])

  React.useEffect(() => {
    const update = () => {
      const foreground = document.visibilityState !== 'hidden'
      diffController.setActive(visible && tab === 'diff' && foreground)
      refreshLoop.setActive(visible && (tab === 'files' || tab === 'diff') && foreground)
    }
    const focus = () => refreshLoop.invalidate()
    update()
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', focus)
    return () => {
      refreshLoop.setActive(false)
      diffController.setActive(false)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', focus)
    }
  }, [diffController, refreshLoop, tab, visible])
  const previousRefreshRevision = React.useRef(refreshRevision)
  React.useEffect(() => {
    if (previousRefreshRevision.current === refreshRevision) return
    previousRefreshRevision.current = refreshRevision
    refreshLoop.invalidate()
  }, [refreshLoop, refreshRevision])
  React.useEffect(() => () => {
    lifecycle.current += 1
    refreshLoop.dispose()
    resources.dispose()
    diffController.dispose()
  }, [diffController, refreshLoop, resources])
  React.useEffect(() => { resources.setSession(sessionKey) }, [resources, sessionKey])
  React.useEffect(() => {
    if (resourceSnapshot.activePath) setCurrentPath(resourceSnapshot.activePath)
    onPreviewStateChange?.(resourceSnapshot.files.find((file) => file.path === resourceSnapshot.activePath) ?? null)
  }, [onPreviewStateChange, resourceSnapshot])

  const onExpansionChange = React.useCallback((path: string, open: boolean) => {
    if (open) expandedDirectories.current.add(path)
    else expandedDirectories.current.delete(path)
  }, [])
  const searchFiles = React.useCallback(async (query: string) => {
    const result = await adapter.files.search(workspaceId, query)
    if (result.workspaceId !== workspaceId) throw { code: 'WORKSPACE_CONTENT_STALE_WORKSPACE' }
    return result
  }, [adapter, workspaceId])
  const showChanges = (path: string) => {
    setDiffFocus({ path, sequence: ++focusSequence.current })
    onTabChange('diff')
  }
  const emptyDiffMessage = diffSnapshot.gitAvailable ? t('inspector.diff.clean') : t('inspector.diff.gitUnavailable')

  return <>
    <InspectorView view="files" activeView={tab}>
      <InspectorFileTabs controller={resources} snapshot={resourceSnapshot} errorMessageKey={errorMessageKey} onAddToComposer={onAddWorkspaceReference} onShowChanges={showChanges} workspaceName={workspaceName}>
        <FileTree
          root={root} workspaceName={workspaceName} workingTreeLabel={t('inspector.files.workspaceTree')}
          currentPath={currentPath} modifiedCount={modifiedCount}
          onExpand={loadDirectory} onExpansionChange={onExpansionChange}
          onRefresh={() => refreshLoop.invalidate()} onSelect={resources.open}
          onShowChanges={showChanges}
          onAddToComposer={onAddWorkspaceReference} loading={fileListState.status === 'loading'}
          errorMessage={fileListState.status === 'error' ? t(errorMessageKey(fileListState.code)) : undefined}
          onRetry={() => refreshLoop.invalidate()} onSearch={searchFiles} searchWorkspaceId={workspaceId}
          searchQuery={fileSearchQuery} onSearchQueryChange={setFileSearchQuery}
        />
      </InspectorFileTabs>
    </InspectorView>
    <InspectorView view="diff" activeView={tab}>
      <DiffViewer
        files={diffSnapshot.files} listLoading={diffSnapshot.listLoading} listTruncated={diffSnapshot.listTruncated}
        listErrorMessage={diffSnapshot.listErrorCode ? t(errorMessageKey(diffSnapshot.listErrorCode)) : undefined}
        emptyMessage={emptyDiffMessage} onRefresh={() => refreshLoop.invalidate()}
        onRequestFile={diffController.request} onRetryFile={diffController.request}
        visible={visible && tab === 'diff'} focusRequest={diffFocus}
        onOpenFile={(path) => { if (resources.open(path)) onTabChange('files') }}
      />
    </InspectorView>
  </>
}

export function InspectorPanel(props: InspectorPanelProps) {
  const t = useT()
  const workspaceStore = useWorkspaceStore()
  const [adapter] = React.useState(createDefaultWorkspaceAdapter)
  const [internalTab, setInternalTab] = React.useState<InspectorTab>('files')
  const activeTab = props.activeTab ?? internalTab
  const onActiveTabChange = React.useCallback((tab: InspectorTab) => {
    if (props.activeTab === undefined) setInternalTab(tab)
    props.onActiveTabChange?.(tab)
  }, [props.activeTab, props.onActiveTabChange])
  const selectedProject = workspaceStore.activeScope.kind === 'project' && workspaceStore.workspace?.id === workspaceStore.activeScope.workspaceId
    ? workspaceStore.workspace : null
  const workspace = selectedProject?.available ? selectedProject : null
  const visible = props.visible ?? true
  const emptyMessage = workspaceStore.activeScope.kind === 'project' ? t('inspector.project.unavailable') : t('inspector.project.required')
  const onBack = activeTab === 'command' ? props.onCloseCommand : activeTab === 'subagent' ? props.onCloseSubagent : undefined

  return <aside aria-label={t('inspector.title')} style={{ width: props.width, maxWidth: '100%' }} className="relative flex h-full min-w-0 flex-col border-l border-border bg-surface">
    <div data-inspector-views className="flex min-h-0 flex-1 flex-col gap-0">
      <InspectorToolbar activeView={activeTab} onViewChange={onActiveTabChange} onClose={props.onClose} onBack={onBack} workspaceName={selectedProject?.name} onExpand={props.onExpand} expanded={props.expanded} />
      {workspace && adapter ? <WorkspaceInspectorTabs
        key={workspace.id} adapter={adapter} workspaceId={workspace.id} workspaceName={workspace.name}
        tab={activeTab} onTabChange={onActiveTabChange} visible={visible} sessionKey={props.sessionKey}
        previewState={props.previewState} onPreviewStateChange={props.onPreviewStateChange}
        refreshRevision={props.refreshRevision}
        onAddWorkspaceReference={props.conversation.status === 'ready' ? props.onAddWorkspaceReference : undefined}
      /> : <>
        <InspectorView view="files" activeView={activeTab}><p role="status" className="flex h-full items-center justify-center px-6 text-center text-caption text-muted-foreground">{emptyMessage}</p></InspectorView>
        <InspectorView view="diff" activeView={activeTab}><p role="status" className="flex h-full items-center justify-center px-6 text-center text-caption text-muted-foreground">{emptyMessage}</p></InspectorView>
      </>}
      {props.subagentCall && props.onCloseSubagent ? <InspectorView view="subagent" activeView={activeTab}><SubagentExecutionPanel call={props.subagentCall} onClose={props.onCloseSubagent} /></InspectorView> : null}
      {props.commandCall && props.onCloseCommand ? <InspectorView view="command" activeView={activeTab}><CommandExecutionPanel call={props.commandCall} onClose={props.onCloseCommand} /></InspectorView> : null}
    </div>
  </aside>
}
