import * as React from 'react'
import {
  TbAlertCircle,
  TbChevronRight,
  TbLoader2,
  TbRefresh,
  TbSearch,
  TbX,
} from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type {
  WorkspacePathSearchEntry,
  WorkspacePathSearchResult,
} from '@/shared/workspace-content'
import type { FileNode } from '@/types/chat'
import {
  fileTreeSearchAction,
  normalizeFileTreeSearchQuery,
  projectFileTreeSearchResult,
  type FileTreeSearchState,
} from './file-tree-search'
import { MaterialFileIcon } from './MaterialFileIcon'
import { InspectorSectionToolbar } from './InspectorSectionToolbar'
import { WorkspacePathContextMenu } from './WorkspacePathContextMenu'
import { adjacentFileRowIndex } from './file-tree-state'

const statusDot = {
  modified: 'bg-warning',
  added: 'bg-sage',
  deleted: 'bg-destructive',
} as const

interface FileTreeProps {
  root: FileNode
  workspaceName: string
  currentPath?: string
  workingTreeLabel?: string
  modifiedCount?: number
  onExpand?: (path: string) => Promise<void>
  onExpansionChange?: (path: string, open: boolean) => void
  onRefresh?: () => void
  onSelect?: (path: string) => void
  onAddToComposer?: (entry: WorkspacePathSearchEntry) => void
  onShowChanges?: (path: string) => void
  loading?: boolean
  errorMessage?: string
  onRetry?: () => void
  onSearch?: (query: string) => Promise<WorkspacePathSearchResult>
  searchWorkspaceId?: string
  searchQuery?: string
  onSearchQueryChange?: (query: string) => void
}

function TreeNode({
  node,
  depth,
  currentPath,
  onExpand,
  onExpansionChange,
  onSelect,
  onAddToComposer,
  onShowChanges,
}: {
  node: FileNode
  depth: number
  currentPath?: string
  onExpand?: (path: string) => Promise<void>
  onExpansionChange?: (path: string, open: boolean) => void
  onSelect?: (path: string) => void
  onAddToComposer?: (entry: WorkspacePathSearchEntry) => void
  onShowChanges?: (path: string) => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(depth < 2 && node.children !== undefined)
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState(false)
  const loadPending = React.useRef(false)
  const isDir = node.type === 'dir'
  const current = !isDir && currentPath === node.path

  React.useEffect(() => {
    if (!isDir) return
    onExpansionChange?.(node.path, open)
    return () => onExpansionChange?.(node.path, false)
  }, [isDir, node.path, onExpansionChange, open])

  const loadChildren = React.useCallback(async () => {
    if (!onExpand || loadPending.current) return false
    loadPending.current = true
    setLoading(true)
    setLoadError(false)
    try {
      await onExpand(node.path)
      return true
    } catch {
      setLoadError(true)
      return false
    } finally {
      loadPending.current = false
      setLoading(false)
    }
  }, [node.path, onExpand])

  React.useEffect(() => {
    // A root refresh invalidates directory contents, not the user's expansion.
    if (isDir && open && (node.children === undefined || node.loaded === false) && !loading && !loadError) void loadChildren()
  }, [isDir, loadChildren, loadError, loading, node.children, node.loaded, open])

  React.useEffect(() => {
    if (node.loaded === true) setLoadError(false)
  }, [node.loaded])

  const activate = async () => {
    if (!isDir) {
      onSelect?.(node.path)
      return
    }
    const nextOpen = !open
    if (loadError) {
      if (await loadChildren()) setOpen(true)
      return
    }
    if (nextOpen && node.children === undefined && onExpand) {
      if (!await loadChildren()) return
    }
    setOpen(nextOpen)
  }

  const row = (
    <button
        type="button"
        onClick={() => void activate()}
        data-workspace-tree-row={node.path}
        onKeyDown={(event) => {
          const tree = event.currentTarget.closest('[data-workspace-tree]')
          const rows = tree ? Array.from(tree.querySelectorAll<HTMLButtonElement>('[data-workspace-tree-row]')).filter((row) => row.offsetParent !== null) : []
          const index = rows.indexOf(event.currentTarget)
          let target: HTMLButtonElement | undefined
          const nextIndex = adjacentFileRowIndex(event.key, index, rows.length)
          if (nextIndex !== null) target = rows[nextIndex]
          else if (event.key === 'ArrowRight' && isDir) {
            if (!open) void activate()
            else if (rows[index + 1]?.dataset.workspaceTreeRow?.startsWith(`${node.path}/`)) target = rows[index + 1]
          } else if (event.key === 'ArrowLeft') {
            if (isDir && open) setOpen(false)
            else {
              const parent = node.path.split('/').slice(0, -1).join('/')
              target = rows.find((row) => row.dataset.workspaceTreeRow === parent)
            }
          } else return
          event.preventDefault()
          target?.focus()
        }}
        aria-expanded={isDir ? open : undefined}
        aria-current={current || undefined}
        aria-busy={loading || undefined}
        title={node.path}
        className={cn(
          'flex h-[var(--tree-row-h)] w-full cursor-pointer items-center gap-1 rounded-sm px-1 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring',
          current && 'bg-accent/70',
        )}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {loading ? (
          <TbLoader2
            className="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden
          />
        ) : isDir ? (
          <TbChevronRight className={cn('size-3 shrink-0 text-muted-foreground/70 transition-transform duration-(--duration-fast)', open && 'rotate-90')} aria-hidden />
        ) : (
          <span className="size-3 shrink-0" aria-hidden />
        )}
        <MaterialFileIcon
          name={node.name}
          path={node.path}
          type={node.type}
          open={isDir && open}
        />
        <span
          className={cn(
            'truncate font-mono text-caption',
            isDir ? 'font-medium text-foreground/90' : current ? 'text-foreground' : 'text-foreground/85',
            node.status === 'deleted' && 'line-through opacity-70',
          )}
        >
          {node.name}
        </span>
        {node.status && (
          <span
            role="img"
            aria-label={t(`inspector.files.${node.status}`)}
            title={t(`inspector.files.${node.status}`)}
            className={cn('ml-auto size-1.5 shrink-0 rounded-full', statusDot[node.status])}
          />
        )}
    </button>
  )

  return (
    <li>
      <WorkspacePathContextMenu
        entry={{ name: node.name, path: node.path, type: node.type }}
        onAddToComposer={onAddToComposer}
        onShowChanges={onShowChanges}
      >
        {row}
      </WorkspacePathContextMenu>
      {loadError ? (
        <p
          role="alert"
          className="py-1 pr-2 text-micro leading-relaxed text-destructive"
          style={{ paddingLeft: `${(depth + 1) * 14 + 4}px` }}
        >
          {t('inspector.files.directoryLoadError')}
        </p>
      ) : null}
      {isDir && open && node.children && (
        <ul>
          {node.children.map((c) => (
            <TreeNode
              key={c.path}
              node={c}
              depth={depth + 1}
              currentPath={currentPath}
              onExpand={onExpand}
              onExpansionChange={onExpansionChange}
              onSelect={onSelect}
              onAddToComposer={onAddToComposer}
              onShowChanges={onShowChanges}
            />
          ))}
          {node.truncated && (
            <li className="px-2 py-1 font-mono text-micro text-muted-foreground">
              {t('inspector.files.truncated')}
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

export function FileTree({
  root,
  workspaceName,
  currentPath,
  workingTreeLabel,
  modifiedCount,
  onExpand,
  onExpansionChange,
  onRefresh,
  onSelect,
  onAddToComposer,
  onShowChanges,
  loading = false,
  errorMessage,
  onRetry,
  onSearch,
  searchWorkspaceId,
  searchQuery,
  onSearchQueryChange,
}: FileTreeProps) {
  const t = useT()
  const [internalQuery, setInternalQuery] = React.useState('')
  const query = searchQuery ?? internalQuery
  const setQuery = React.useCallback((nextQuery: string) => {
    if (searchQuery === undefined) setInternalQuery(nextQuery)
    onSearchQueryChange?.(nextQuery)
  }, [onSearchQueryChange, searchQuery])
  const [searchRevision, setSearchRevision] = React.useState(0)
  const searchInput = React.useRef<HTMLInputElement>(null)
  const contentId = React.useId()
  const [searchState, setSearchState] = React.useState<FileTreeSearchState>({ status: 'idle' })
  const normalizedQuery = normalizeFileTreeSearchQuery(query)
  const modified = React.useMemo(() => {
    let n = 0
    const walk = (f: FileNode) => {
      if (f.status) n++
      f.children?.forEach(walk)
    }
    walk(root)
    return n
  }, [root])

  React.useEffect(() => {
    if (!onSearch || !normalizedQuery) {
      setSearchState({ status: 'idle' })
      return
    }
    let disposed = false
    setSearchState({ status: 'loading' })
    const timer = setTimeout(() => {
      void onSearch(normalizedQuery)
        .then((result) => {
          if (disposed) return
          const projected = searchWorkspaceId
            ? projectFileTreeSearchResult(searchWorkspaceId, normalizedQuery, result)
            : null
          if (!projected) {
            setSearchState({ status: 'error' })
            return
          }
          setSearchState(projected)
        })
        .catch(() => {
          if (!disposed) setSearchState({ status: 'error' })
        })
    }, 140)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [normalizedQuery, onSearch, searchRevision, searchWorkspaceId])

  const searchContent = normalizedQuery ? (
    searchState.status === 'loading' || searchState.status === 'idle' ? (
      <div className="flex h-full min-h-24 items-center justify-center gap-2 px-4 text-center text-caption text-muted-foreground" role="status">
        <TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        {t('inspector.files.searching')}
      </div>
    ) : searchState.status === 'error' ? (
      <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 px-4 text-center text-caption" role="alert">
        <TbAlertCircle className="size-4 text-destructive" aria-hidden />
        <p className="text-destructive">{t('inspector.files.searchError')}</p>
        <Button variant="outline" size="xs" onClick={() => setSearchRevision((value) => value + 1)}>
          <TbRefresh aria-hidden />
          {t('common.retry')}
        </Button>
      </div>
    ) : searchState.entries.length === 0 ? (
      <div className="flex h-full min-h-24 items-center justify-center px-4 text-center text-caption text-muted-foreground">
        {t('inspector.files.noSearchResults')}
      </div>
    ) : (
      <div>
        <ul aria-label={t('inspector.files.searchResults')}>
          {searchState.entries.map((entry) => {
            const row = (
              <button
                type="button"
                data-workspace-search-row={entry.path}
                className={cn('flex min-h-[var(--tree-row-h)] w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring', entry.type === 'file' && entry.path === currentPath && 'bg-selected')}
                aria-current={entry.type === 'file' && entry.path === currentPath || undefined}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') { searchInput.current?.focus(); event.preventDefault(); return }
                  const list = event.currentTarget.closest('ul')
                  const rows = list ? Array.from(list.querySelectorAll<HTMLButtonElement>('[data-workspace-search-row]')) : []
                  const nextIndex = adjacentFileRowIndex(event.key, rows.indexOf(event.currentTarget), rows.length)
                  if (nextIndex === null) return
                  event.preventDefault()
                  rows[nextIndex]?.focus()
                }}
                onClick={() => {
                  const action = fileTreeSearchAction(entry)
                  if (action.type === 'preview') onSelect?.(action.path)
                  else { setQuery(action.query); searchInput.current?.focus() }
                }}
                title={entry.path}
              >
                <MaterialFileIcon
                  name={entry.name}
                  path={entry.path}
                  type={entry.type}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-caption text-foreground">
                    {entry.name}
                  </span>
                  <span className="block truncate font-mono text-micro text-muted-foreground">
                    {entry.path}
                  </span>
                </span>
                {entry.type === 'dir' ? (
                  <TbChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                ) : null}
              </button>
            )
            return (
              <li key={entry.path}>
                <WorkspacePathContextMenu entry={entry} onAddToComposer={onAddToComposer} onShowChanges={onShowChanges}>
                  {row}
                </WorkspacePathContextMenu>
              </li>
            )
          })}
        </ul>
        {searchState.truncated ? (
          <p className="border-t border-border/60 px-2 py-1.5 text-micro text-muted-foreground">
            {t('inspector.files.searchTruncated')}
          </p>
        ) : null}
      </div>
    )
  ) : null

  return (
    <div className="flex h-full min-w-0 flex-col" data-workspace-tree>
      <InspectorSectionToolbar title={workingTreeLabel ?? workspaceName} description={t('inspector.files.modifiedSummary', { count: modifiedCount ?? modified })}>
        {onRefresh ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('inspector.refresh')}
            title={t('inspector.refresh')}
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <TbRefresh aria-hidden />}
          </Button>
        ) : null}
      </InspectorSectionToolbar>
      {errorMessage && root.children?.length ? <div role="alert" className="flex items-center gap-2 border-b border-border px-3 py-2 text-caption text-destructive"><span className="min-w-0 flex-1">{errorMessage}</span>{onRetry ? <Button variant="ghost" size="xs" onClick={onRetry}>{t('common.retry')}</Button> : null}</div> : null}
      {onSearch ? (
        <div className="relative border-b border-border/60 p-1.5">
          <TbSearch
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
            aria-hidden
          />
          <Input
            ref={searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setQuery('')
                event.preventDefault()
              } else if (event.key === 'ArrowDown') {
                const content = document.getElementById(contentId)
                content?.querySelector<HTMLButtonElement>('[data-workspace-search-row], [data-workspace-tree-row]')?.focus()
                event.preventDefault()
              }
            }}
            placeholder={t('inspector.files.searchPlaceholder')}
            aria-label={t('inspector.files.search')}
            aria-controls={contentId}
            autoComplete="off"
            className="h-7 pl-7 pr-7 text-caption"
          />
          {query ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={() => { setQuery(''); searchInput.current?.focus() }}
              aria-label={t('inspector.files.clearSearch')}
            >
              <TbX aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : null}
      <div
        id={contentId}
        aria-busy={loading || searchState.status === 'loading' || undefined}
        className="scroll-slim min-h-0 flex-1 overflow-y-auto p-1"
      >
        {normalizedQuery ? searchContent : loading && !root.children?.length ? (
          <div className="flex h-full min-h-24 items-center justify-center gap-2 px-4 text-center text-caption text-muted-foreground" role="status">
            <TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            {t('inspector.files.loading')}
          </div>
        ) : errorMessage && !root.children?.length ? (
          <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 px-4 text-center text-caption" role="alert">
            <TbAlertCircle className="size-4 text-destructive" aria-hidden />
            <p className="text-destructive">{errorMessage}</p>
            {onRetry ? (
              <Button variant="outline" size="xs" onClick={onRetry}>
                <TbRefresh aria-hidden />
                {t('common.retry')}
              </Button>
            ) : null}
          </div>
        ) : root.children?.length ? (
          <ul aria-label={t('inspector.tab.files')}>
            {root.children.map((c) => (
              <TreeNode
                key={c.path}
                node={c}
                depth={0}
                currentPath={currentPath}
                onExpand={onExpand}
                onExpansionChange={onExpansionChange}
                onSelect={onSelect}
                onAddToComposer={onAddToComposer}
                onShowChanges={onShowChanges}
              />
            ))}
            {root.truncated && (
              <li className="px-2 py-1 font-mono text-micro text-muted-foreground">
                {t('inspector.files.truncated')}
              </li>
            )}
          </ul>
        ) : (
          <div className="flex h-full min-h-24 items-center justify-center px-4 text-center text-caption text-muted-foreground">
            {t('inspector.files.empty')}
          </div>
        )}
      </div>
    </div>
  )
}
