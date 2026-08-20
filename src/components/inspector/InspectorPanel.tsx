import * as React from 'react'
import { TbLoader2 } from 'react-icons/tb'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useT, type MessageKey } from '@/i18n'
import {
  createDefaultWorkspaceAdapter,
  type WorkspaceAdapter,
} from '@/renderer/adapters/workspace-adapter'
import { useWorkspaceStore } from '@/store/workspace'
import type { PiConversationPresentation } from '@/store/pi-rpc'
import type { PiPilotApiError } from '@/shared/pipilot-api'
import type { WorkspaceFilePreview } from '@/shared/workspace-content'
import type { ConversationOutlineItem, FileNode, ToolCall } from '@/types/chat'
import { FileTree } from './FileTree'
import { DiffViewer } from './DiffViewer'
import { ConversationOutlinePanel } from './ConversationOutlinePanel'
import { ContinuousDiffController } from './continuous-diff-controller'
import { TerminalLoadingFallback } from './TerminalPanel'
import { WorkspaceFileViewer } from './WorkspaceFileViewer'
import { SubagentExecutionPanel } from './SubagentExecutionPanel'

const RealTerminalPanel = React.lazy(() =>
  import('./RealTerminalPanel').then((module) => ({
    default: module.RealTerminalPanel,
  })),
)

interface InspectorPanelProps {
  width: number
  conversation: PiConversationPresentation
  outline: readonly ConversationOutlineItem[]
  outlineSessionKey: string | null
  onNavigateOutline: (entryId: string) => void
  subagentCall?: ToolCall | null
  onCloseSubagent?: () => void
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
          <TbLoader2 className="size-4 animate-spin" aria-hidden />
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
  tab,
  workspaceId,
  workspaceName,
}: {
  adapter: WorkspaceAdapter
  outline: readonly ConversationOutlineItem[]
  outlineSessionKey: string | null
  onNavigateOutline: (entryId: string) => void
  tab: string
  workspaceId: string
  workspaceName: string
}) {
  const t = useT()
  const workspaceStore = useWorkspaceStore()
  const [root, setRoot] = React.useState<FileNode>({
    name: workspaceName,
    path: '.',
    type: 'dir',
    children: [],
    loaded: true,
  })
  const [modifiedCount, setModifiedCount] = React.useState(0)
  const [currentPath, setCurrentPath] = React.useState<string>()
  const [previewPath, setPreviewPath] = React.useState<string>()
  const [preview, setPreview] = React.useState<WorkspaceFilePreview>()
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [previewErrorCode, setPreviewErrorCode] = React.useState<string>()
  const [diffController] = React.useState(() => new ContinuousDiffController((path) => {
    return adapter.changes.read(workspaceId, path)
  }))
  const diffSnapshot = React.useSyncExternalStore(
    diffController.subscribe,
    diffController.getSnapshot,
    diffController.getSnapshot,
  )
  const [failureCode, setFailureCode] = React.useState<string>()
  const directoryEpoch = React.useRef(0)
  const lifecycleEpoch = React.useRef(0)
  const previewEpoch = React.useRef(0)

  const fail = React.useCallback((error: unknown) => {
    setFailureCode(errorCode(error))
  }, [])

  const loadDirectory = React.useCallback(async (path: string) => {
    const lifecycle = lifecycleEpoch.current
    const epoch = path === '.' ? ++directoryEpoch.current : directoryEpoch.current
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
    } catch (error) {
      if (
        lifecycle !== lifecycleEpoch.current ||
        (path === '.' && epoch !== directoryEpoch.current)
      ) return
      fail(error)
      throw error
    }
  }, [adapter, fail, workspaceId])

  const refreshFiles = React.useCallback(async () => {
    await loadDirectory('.')
  }, [loadDirectory])

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
    void Promise.all([refreshFiles(), loadChanges()]).catch(() => undefined)
  }, [loadChanges, refreshFiles])

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
    try {
      const nextPreview = await adapter.files.preview(workspaceId, path)
      if (
        lifecycle !== lifecycleEpoch.current ||
        epoch !== previewEpoch.current
      ) return
      setPreview(nextPreview)
    } catch (error) {
      if (
        lifecycle !== lifecycleEpoch.current ||
        epoch !== previewEpoch.current
      ) return
      setPreview(undefined)
      setPreviewErrorCode(errorCode(error))
    } finally {
      if (
        lifecycle === lifecycleEpoch.current &&
        epoch === previewEpoch.current
      ) setPreviewLoading(false)
    }
  }, [adapter, workspaceId])

  const closePreview = React.useCallback(() => {
    previewEpoch.current += 1
    setPreviewPath(undefined)
    setPreview(undefined)
    setPreviewLoading(false)
    setPreviewErrorCode(undefined)
  }, [])

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

      <AlertDialog
        open={Boolean(failureCode)}
        onOpenChange={(open) => {
          if (!open) setFailureCode(undefined)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('inspector.error.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(errorMessageKey(failureCode ?? 'UNKNOWN_ERROR'))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setFailureCode(undefined)}>
              {t('common.close')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ElectronInspector({
  width,
  conversation,
  outline,
  outlineSessionKey,
  onNavigateOutline,
  workspaceId,
  workspaceName,
  subagentCall,
  onCloseSubagent,
}: InspectorPanelProps & {
  workspaceId: string
  workspaceName: string
}) {
  const t = useT()
  const [adapter] = React.useState(createDefaultWorkspaceAdapter)
  const [tab, setTab] = React.useState('files')
  const [terminalActivated, setTerminalActivated] = React.useState(false)
  const blockedConversation: Exclude<PiConversationPresentation, { status: 'ready' }> =
    conversation.status === 'ready'
      ? { status: 'error', error: t('inspector.error.generic') }
      : conversation

  return (
    <aside
      aria-label={t('inspector.title')}
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-sidebar"
    >
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value)
          if (value === 'terminal') setTerminalActivated(true)
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex h-8 items-center gap-1 border-b border-border/60 px-2">
          <TabsList className="h-7 w-full justify-start">
            <TabsTrigger value="files" className="flex-none px-2 text-caption">{t('inspector.tab.files')}</TabsTrigger>
            <TabsTrigger value="diff" className="flex-none px-2 text-caption">{t('inspector.tab.diff')}</TabsTrigger>
            <TabsTrigger value="outline" className="flex-none px-2 text-caption">{t('inspector.tab.outline')}</TabsTrigger>
            <TabsTrigger value="terminal" className="flex-none px-2 text-caption">{t('inspector.tab.terminal')}</TabsTrigger>
          </TabsList>
        </div>

        {conversation.status === 'ready' && adapter ? (
          <ReadySessionOwnedTabs
            key={`${workspaceId}:${conversation.sessionId}`}
            adapter={adapter}
            outline={outline}
            outlineSessionKey={outlineSessionKey}
            onNavigateOutline={onNavigateOutline}
            tab={tab}
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
  conversation,
  outline,
  outlineSessionKey,
  onNavigateOutline,
  subagentCall,
  onCloseSubagent,
}: InspectorPanelProps) {
  const t = useT()
  const workspaceStore = useWorkspaceStore()
  const [adapter] = React.useState(createDefaultWorkspaceAdapter)
  const [terminalActivated, setTerminalActivated] = React.useState(false)
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
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-sidebar"
    >
      <Tabs
        defaultValue="files"
        className="flex min-h-0 flex-1 flex-col"
        onValueChange={(value) => {
          if (value === 'terminal') setTerminalActivated(true)
        }}
      >
        <div className="flex h-8 items-center gap-1 border-b border-border/60 px-2">
          <TabsList className="h-7 w-full justify-start">
            <TabsTrigger value="files" className="flex-none px-2 text-caption">{t('inspector.tab.files')}</TabsTrigger>
            <TabsTrigger value="diff" className="flex-none px-2 text-caption">{t('inspector.tab.diff')}</TabsTrigger>
            <TabsTrigger value="outline" className="flex-none px-2 text-caption">{t('inspector.tab.outline')}</TabsTrigger>
            <TabsTrigger value="terminal" className="flex-none px-2 text-caption">{t('inspector.tab.terminal')}</TabsTrigger>
          </TabsList>
        </div>
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
  if (workspaceStore.mode === 'electron' && workspaceStore.workspace?.available) {
    return (
      <ElectronInspector
        key={workspaceStore.workspace.id}
        {...props}
        workspaceId={workspaceStore.workspace.id}
        workspaceName={workspaceStore.workspace.name}
      />
    )
  }
  return <EmptyElectronInspector {...props} />
}
