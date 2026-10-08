import * as React from 'react'
import { createPortal } from 'react-dom'
import { useT, type MessageKey } from '@/i18n'
import type { WorkspaceAdapter } from '@/renderer/adapters/workspace-adapter'
import type { PiPilotApiError } from '@/shared/pipilot-api'
import type { WorkspacePathSearchEntry } from '@/shared/workspace-content'
import type { FileNode } from '@/types/chat'
import { FileTree } from './FileTree'
import type { FileDiffLoadedFiles } from '@pierre/diffs'
import { DiffViewer, type DiffChangeAction, type DiffViewerFile } from './DiffViewer'
import type { WorkspaceCommitSummary } from '@/shared/workspace-content'
import type { DiffScope } from './diff-scope'
import { ContinuousDiffController } from './continuous-diff-controller'
import { InspectorResourcesController } from './inspector-resources'
import { replaceFileTreeChildren } from './file-tree-state'
import { ResourceRefreshLoop } from './resource-refresh-loop'
import { WorkspaceFileViewer } from './WorkspaceFileViewer'
import type { PanelTabContainers } from './PanelTabStrip'

function errorCode(error: unknown) {
  const code = (error as Partial<PiPilotApiError> | null)?.code
  return typeof code === 'string' ? code : 'UNKNOWN_ERROR'
}

export function workspaceErrorMessageKey(code: string): MessageKey {
  if (code === 'WORKSPACE_CHANGE_CONFLICT') return 'inspector.error.conflict'
  if (code === 'WORKSPACE_CHANGE_FAILED') return 'inspector.diff.actionFailed'
  if (code === 'WORKSPACE_GIT_UNAVAILABLE') return 'inspector.error.gitUnavailable'
  if (code === 'WORKSPACE_CONTENT_STALE_WORKSPACE') return 'inspector.error.staleWorkspace'
  if (code === 'WORKSPACE_PATH_NOT_FOUND') return 'inspector.error.missingFile'
  if (code.startsWith('WORKSPACE_PATH_')) return 'inspector.error.invalidPath'
  return 'inspector.error.generic'
}

/** What the toolbar and summary show about uncommitted work. */
export interface WorkspaceChangeTotals {
  gitAvailable: boolean
  loaded: boolean
  files: number
  added: number
  deleted: number
}

const QUIET_REFRESH_MS = 15_000
const VISIBLE_REFRESH_MS = 5_000

/**
 * One project's review, file tree and opened files. Each renders into its
 * tab's own element, so it keeps reading state while its tab moves between
 * docks or hides. The change list keeps refreshing quietly for the toolbar.
 */
export function WorkspacePanelContents({ adapter, containers, workspaceId, workspaceName, review, files, fileTabs, visibleFile, active,
  sessionKey, refreshRevision, lastTurnPaths, onOpenFile, onShowReview, onAddWorkspaceReference, onChangeTotals }: {
  adapter: WorkspaceAdapter
  containers: PanelTabContainers
  workspaceId: string
  workspaceName: string
  review: { open: boolean; visible: boolean }
  files: { open: boolean; visible: boolean }
  fileTabs: readonly string[]
  visibleFile: string | null
  /** The app is showing a conversation (not settings) and the window is in front. */
  active: boolean
  sessionKey: string | null
  refreshRevision?: number | string
  lastTurnPaths?: readonly string[]
  onOpenFile(path: string): void
  onShowReview(): void
  onAddWorkspaceReference?: (entry: WorkspacePathSearchEntry) => void
  onChangeTotals?: (totals: WorkspaceChangeTotals) => void
}) {
  const t = useT()
  const [resources] = React.useState(() => new InspectorResourcesController(workspaceId, (path) => adapter.files.preview(workspaceId, path)))
  const resourceSnapshot = React.useSyncExternalStore(resources.subscribe, resources.getSnapshot, resources.getSnapshot)
  const [diffController] = React.useState(() => {
    const controller = new ContinuousDiffController((path, stage) => adapter.changes.read(workspaceId, path, stage))
    controller.setActive(review.visible)
    return controller
  })
  const diffSnapshot = React.useSyncExternalStore(diffController.subscribe, diffController.getSnapshot, diffController.getSnapshot)
  const [diffScope, setDiffScope] = React.useState<DiffScope>('unstaged')
  // Review › Branch: its own list, read only while that scope shows.
  const [branchController] = React.useState(() => new ContinuousDiffController((path) => adapter.changes.read(workspaceId, path, 'branch')))
  const branchSnapshot = React.useSyncExternalStore(branchController.subscribe, branchController.getSnapshot, branchController.getSnapshot)
  const [branchBase, setBranchBase] = React.useState('')
  const branchRead = React.useRef<Promise<void> | null>(null)
  // Review › Commit: recent commits, and the files of the one picked.
  const [commits, setCommits] = React.useState<{ loading: boolean; items: readonly WorkspaceCommitSummary[] }>({ loading: false, items: [] })
  const [selectedCommit, setSelectedCommit] = React.useState<string | null>(null)
  const selectedCommitRef = React.useRef(selectedCommit)
  selectedCommitRef.current = selectedCommit
  const [commitController] = React.useState(() => new ContinuousDiffController((path) => adapter.changes.read(workspaceId, path, 'commit', selectedCommitRef.current ?? undefined)))
  const commitSnapshot = React.useSyncExternalStore(commitController.subscribe, commitController.getSnapshot, commitController.getSnapshot)
  const [root, setRoot] = React.useState<FileNode>({ name: workspaceName, path: '.', type: 'dir', children: [], loaded: false })
  const [fileListState, setFileListState] = React.useState<{ status: 'loading' | 'ready' } | { status: 'error'; code: string }>({ status: 'loading' })
  const [modifiedCount, setModifiedCount] = React.useState(0)
  const [fileSearchQuery, setFileSearchQuery] = React.useState('')
  const [diffFocus, setDiffFocus] = React.useState<{ path: string; sequence: number } | null>(null)
  const focusSequence = React.useRef(0)
  const lifecycle = React.useRef(0)
  const rootLoaded = React.useRef(false)
  const directoryReads = React.useRef(new Map<string, Promise<void>>())
  const expandedDirectories = React.useRef(new Set<string>())
  const diffRead = React.useRef<Promise<void> | null>(null)
  const visibility = React.useRef({ review: review.visible, branch: false, commit: false, files: files.visible })
  visibility.current = { review: review.visible, branch: review.visible && diffScope === 'branch', commit: review.visible && diffScope === 'commit', files: files.visible }

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
      diffController.resolveList(epoch, snapshot, visibility.current.review && document.visibilityState !== 'hidden')
    }).catch((error) => { diffController.rejectList(epoch, error) }).finally(() => {
      if (diffRead.current === operation) diffRead.current = null
    })
    diffRead.current = operation
    return operation
  }, [adapter, diffController, workspaceId])

  const loadBranch = React.useCallback((): Promise<void> => {
    if (branchRead.current) return branchRead.current
    const epoch = branchController.beginListLoad()
    const operation = adapter.changes.listBranch(workspaceId).then((snapshot) => {
      if (snapshot.workspaceId !== workspaceId) throw { code: 'WORKSPACE_CONTENT_STALE_WORKSPACE' }
      setBranchBase(snapshot.base)
      branchController.resolveList(epoch, snapshot, visibility.current.branch && document.visibilityState !== 'hidden')
    }).catch((error) => { branchController.rejectList(epoch, error) }).finally(() => {
      if (branchRead.current === operation) branchRead.current = null
    })
    branchRead.current = operation
    return operation
  }, [adapter, branchController, workspaceId])

  const loadCommits = React.useCallback(async () => {
    setCommits((current) => ({ ...current, loading: true }))
    try {
      const list = await adapter.changes.listCommits(workspaceId)
      if (list.workspaceId !== workspaceId) return
      setCommits({ loading: false, items: list.commits })
      // The newest commit until one is picked; a picked commit that left the branch falls back too.
      setSelectedCommit((current) => current && list.commits.some((item) => item.sha === current) ? current : list.commits[0]?.sha ?? null)
    } catch {
      setCommits((current) => ({ ...current, loading: false }))
    }
  }, [adapter, workspaceId])
  const loadCommit = React.useCallback(async (sha: string) => {
    const epoch = commitController.beginListLoad()
    try {
      const snapshot = await adapter.changes.listCommit(workspaceId, sha)
      if (snapshot.workspaceId !== workspaceId || selectedCommitRef.current !== sha) return
      commitController.resolveList(epoch, snapshot, visibility.current.commit && document.visibilityState !== 'hidden')
    } catch (error) {
      commitController.rejectList(epoch, error)
    }
  }, [adapter, commitController, workspaceId])

  const refreshContent = React.useCallback(async () => {
    await Promise.allSettled([
      loadChanges(),
      ...(visibility.current.branch ? [loadBranch()] : []),
      ...(visibility.current.commit ? [loadCommits()] : []),
      ...(visibility.current.files ? [loadDirectory('.'), ...[...expandedDirectories.current].map(loadDirectory)] : []),
      resources.refreshActive(),
    ])
  }, [loadBranch, loadChanges, loadCommits, loadDirectory, resources])
  const refreshOperation = React.useRef(refreshContent)
  refreshOperation.current = refreshContent
  const [refreshLoop] = React.useState(() => new ResourceRefreshLoop(() => refreshOperation.current(), QUIET_REFRESH_MS))
  const showing = review.visible || files.visible || visibleFile !== null

  React.useLayoutEffect(() => {
    diffController.setActive(review.visible && document.visibilityState !== 'hidden')
    return () => diffController.setActive(false)
  }, [diffController, review.visible])
  React.useEffect(() => {
    const visible = review.visible && diffScope === 'branch' && document.visibilityState !== 'hidden'
    branchController.setActive(visible)
    if (visible) void loadBranch()
    return () => branchController.setActive(false)
  }, [branchController, diffScope, loadBranch, review.visible])
  React.useEffect(() => {
    const visible = review.visible && diffScope === 'commit' && document.visibilityState !== 'hidden'
    commitController.setActive(visible)
    if (visible && !commits.items.length && !commits.loading) void loadCommits()
    return () => commitController.setActive(false)
  // Loading is triggered by the scope becoming visible, not by every list change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitController, diffScope, loadCommits, review.visible])
  React.useEffect(() => { if (selectedCommit) void loadCommit(selectedCommit) }, [loadCommit, selectedCommit])
  React.useEffect(() => {
    refreshLoop.setInterval(showing ? VISIBLE_REFRESH_MS : QUIET_REFRESH_MS)
    if (showing) refreshLoop.invalidate()
  }, [refreshLoop, showing])
  React.useEffect(() => {
    const update = () => {
      const foreground = document.visibilityState !== 'hidden'
      diffController.setActive(visibility.current.review && foreground)
      refreshLoop.setActive(active && foreground)
    }
    const focus = () => refreshLoop.invalidate()
    update()
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', focus)
    return () => {
      refreshLoop.setActive(false)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', focus)
    }
  }, [active, diffController, refreshLoop])
  const previousRefreshRevision = React.useRef(refreshRevision)
  React.useEffect(() => {
    if (previousRefreshRevision.current === refreshRevision) return
    previousRefreshRevision.current = refreshRevision
    refreshLoop.invalidate()
  }, [refreshLoop, refreshRevision])
  React.useEffect(() => () => {
    lifecycle.current += 1
    refreshLoop.dispose()
    diffController.dispose()
    branchController.dispose()
    commitController.dispose()
    resources.dispose()
  }, [branchController, commitController, diffController, refreshLoop, resources])
  React.useEffect(() => { resources.setSession(sessionKey) }, [resources, sessionKey])
  // Only the file in view is read; the others load when their tab is shown.
  React.useEffect(() => { if (visibleFile) resources.open(visibleFile) }, [resources, visibleFile])
  // The tree marks the file last read, while its tab is still open.
  const [lastRead, setLastRead] = React.useState<string | null>(null)
  if (visibleFile && visibleFile !== lastRead) setLastRead(visibleFile)
  const readingPath = visibleFile ?? (lastRead && fileTabs.includes(lastRead) ? lastRead : undefined)
  const fileTabKey = fileTabs.join('\u0000')
  React.useEffect(() => { resources.retain(new Set(fileTabs)) },
    // `fileTabKey` covers the list's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resources, fileTabKey])
  React.useEffect(() => { if (files.visible && !rootLoaded.current) void loadDirectory('.') }, [files.visible, loadDirectory])

  // Codex opens on Unstaged; with only staged work there, start on Staged instead.
  const scopeChosen = React.useRef(false)
  React.useEffect(() => {
    if (!review.open) { scopeChosen.current = false; return }
    if (scopeChosen.current || diffSnapshot.listLoading) return
    scopeChosen.current = true
    const stages = new Set(diffSnapshot.files.map((file) => file.stage))
    if (!stages.has('unstaged') && stages.has('staged')) setDiffScope('staged')
  }, [diffSnapshot.files, diffSnapshot.listLoading, review.open])

  const totals = React.useMemo<WorkspaceChangeTotals>(() => {
    const working = diffSnapshot.files
    return {
      gitAvailable: diffSnapshot.gitAvailable,
      loaded: !diffSnapshot.listLoading || working.length > 0,
      files: new Set(working.map((file) => file.path)).size,
      added: working.reduce((sum, file) => sum + file.added, 0),
      deleted: working.reduce((sum, file) => sum + file.deleted, 0),
    }
  }, [diffSnapshot.files, diffSnapshot.gitAvailable, diffSnapshot.listLoading])
  React.useEffect(() => { onChangeTotals?.(totals) }, [onChangeTotals, totals])

  const onExpansionChange = React.useCallback((path: string, open: boolean) => {
    if (open) expandedDirectories.current.add(path)
    else expandedDirectories.current.delete(path)
  }, [])
  const searchFiles = React.useCallback(async (query: string) => {
    const result = await adapter.files.search(workspaceId, query)
    if (result.workspaceId !== workspaceId) throw { code: 'WORKSPACE_CONTENT_STALE_WORKSPACE' }
    return result
  }, [adapter, workspaceId])
  const showChanges = React.useCallback((path: string) => {
    setDiffFocus({ path, sequence: ++focusSequence.current })
    onShowReview()
  }, [onShowReview])
  const applyChange = React.useCallback(async (action: DiffChangeAction, targets: readonly DiffViewerFile[]) => {
    // Branch rows are read-only; only working-tree stages reach Git.
    const working = targets.flatMap(({ path, stage, revision }) => stage === 'branch' || stage === 'commit' ? [] : [{ path, stage, revision }])
    if (!working.length) return
    const snapshot = await adapter.changes.apply(workspaceId, action, working)
    if (snapshot.workspaceId !== workspaceId) throw { code: 'WORKSPACE_CONTENT_STALE_WORKSPACE' }
    // Show the list Git returned at once; the tree's modified marks follow on refresh.
    diffController.resolveList(diffController.beginListLoad(), snapshot, visibility.current.review && document.visibilityState !== 'hidden')
    refreshLoop.invalidate()
  }, [adapter, diffController, refreshLoop, workspaceId])
  const applyHunk = React.useCallback(async (action: DiffChangeAction, file: DiffViewerFile, hunk: number) => {
    if (file.stage === 'branch' || file.stage === 'commit') return
    const snapshot = await adapter.changes.applyHunk(workspaceId, action, { path: file.path, stage: file.stage, revision: file.revision }, hunk)
    if (snapshot.workspaceId !== workspaceId) throw { code: 'WORKSPACE_CONTENT_STALE_WORKSPACE' }
    diffController.resolveList(diffController.beginListLoad(), snapshot, visibility.current.review && document.visibilityState !== 'hidden')
    refreshLoop.invalidate()
  }, [adapter, diffController, refreshLoop, workspaceId])
  const addReference = onAddWorkspaceReference
  const changedPaths = React.useMemo(() => new Set(diffSnapshot.files.map((file) => file.path)), [diffSnapshot.files])
  const readMedia = React.useCallback(async (path: string) => {
    const media = await adapter.files.media(workspaceId, path)
    if (media.workspaceId !== workspaceId || media.path !== path) throw { code: 'WORKSPACE_CONTENT_STALE_WORKSPACE' }
    return media
  }, [adapter, workspaceId])
  const loadSides = React.useCallback(async (file: DiffViewerFile): Promise<FileDiffLoadedFiles> => {
    const sides = await adapter.changes.sides(workspaceId, file.path, file.stage, {
      ...(file.stage === 'commit' && selectedCommitRef.current ? { commit: selectedCommitRef.current } : {}),
      ...(file.previousPath ? { previousPath: file.previousPath } : {}),
    })
    if (sides.workspaceId !== workspaceId || !sides.oldFile || !sides.newFile) throw { code: 'WORKSPACE_CHANGE_CONFLICT' }
    return { oldFile: sides.oldFile, newFile: sides.newFile }
  }, [adapter, workspaceId])
  const describe = (code: string | undefined) => code ? t(workspaceErrorMessageKey(code)) : undefined

  return <>
    {review.open ? createPortal(<DiffViewer
      working={{
        files: diffSnapshot.files, gitAvailable: diffSnapshot.gitAvailable, listLoading: diffSnapshot.listLoading, listTruncated: diffSnapshot.listTruncated,
        listErrorMessage: describe(diffSnapshot.listErrorCode), onRequestFile: diffController.request, onRetryFile: diffController.request,
      }}
      branch={{
        files: branchSnapshot.files, base: branchBase, listLoading: branchSnapshot.listLoading, listTruncated: branchSnapshot.listTruncated,
        listErrorMessage: describe(branchSnapshot.listErrorCode), onRequestFile: branchController.request, onRetryFile: branchController.request,
      }}
      commit={{
        files: commitSnapshot.files, listLoading: commitSnapshot.listLoading && Boolean(selectedCommit), listTruncated: commitSnapshot.listTruncated,
        listErrorMessage: describe(commitSnapshot.listErrorCode), onRequestFile: commitController.request, onRetryFile: commitController.request,
        commits: commits.items, commitsLoading: commits.loading, selected: selectedCommit, onSelect: setSelectedCommit,
      }}
      scope={diffScope}
      onScopeChange={setDiffScope}
      onRefresh={() => refreshLoop.invalidate()}
      visible={review.visible}
      focusRequest={diffFocus}
      onOpenFile={onOpenFile}
      lastTurnPaths={lastTurnPaths}
      onChangeAction={applyChange}
      onHunkAction={applyHunk}
      describeError={(error) => t(workspaceErrorMessageKey(errorCode(error)))}
      loadSides={loadSides}
    />, containers.get('review')) : null}
    {files.open ? createPortal(<FileTree
      root={root} workspaceName={workspaceName} workingTreeLabel={t('inspector.files.workspaceTree')}
      currentPath={readingPath} modifiedCount={modifiedCount}
      onExpand={loadDirectory} onExpansionChange={onExpansionChange}
      onRefresh={() => refreshLoop.invalidate()} onSelect={onOpenFile}
      onShowChanges={showChanges}
      onAddToComposer={addReference} loading={fileListState.status === 'loading'}
      errorMessage={fileListState.status === 'error' ? t(workspaceErrorMessageKey(fileListState.code)) : undefined}
      onRetry={() => refreshLoop.invalidate()} onSearch={searchFiles} searchWorkspaceId={workspaceId}
      searchQuery={fileSearchQuery} onSearchQueryChange={setFileSearchQuery}
    />, containers.get('files')) : null}
    {fileTabs.map((path) => {
      const file = resourceSnapshot.files.find((item) => item.path === path)
      return createPortal(<WorkspaceFileViewer
        key={path}
        path={path}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        visible={visibleFile === path}
        modified={changedPaths.has(path)}
        onReadMedia={readMedia}
        onReveal={() => void adapter.files.reveal(workspaceId, path).catch(() => undefined)}
        preview={file?.preview}
        loading={!file || (file.phase === 'loading' && !file.preview)}
        refreshing={file?.phase === 'loading' && Boolean(file.preview)}
        errorMessage={file?.errorCode ? t(workspaceErrorMessageKey(file.errorCode)) : undefined}
        onRetry={() => resources.open(path, true)}
        onRefresh={() => resources.open(path, true)}
        onShowChanges={() => showChanges(path)}
        onAddToComposer={addReference ? () => addReference({ path, name: path.split('/').pop() ?? path, type: 'file' }) : undefined}
      />, containers.get(`file:${path}`), path)
    })}
  </>
}
