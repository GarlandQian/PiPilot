import * as React from 'react'
import { TbChevronRight, TbRefresh } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { FileNode } from '@/types/chat'
import { MaterialFileIcon } from './MaterialFileIcon'

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
  onRefresh?: () => void
  onSelect?: (path: string) => void
}

function TreeNode({
  node,
  depth,
  currentPath,
  onExpand,
  onSelect,
}: {
  node: FileNode
  depth: number
  currentPath?: string
  onExpand?: (path: string) => Promise<void>
  onSelect?: (path: string) => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(depth < 2 && node.children !== undefined)
  const [loading, setLoading] = React.useState(false)
  const isDir = node.type === 'dir'
  const current = !isDir && currentPath === node.path

  React.useEffect(() => {
    if (isDir && node.children === undefined && open) setOpen(false)
  }, [isDir, node.children, open])

  const activate = async () => {
    if (!isDir) {
      onSelect?.(node.path)
      return
    }
    const nextOpen = !open
    if (nextOpen && node.children === undefined && onExpand) {
      setLoading(true)
      try {
        await onExpand(node.path)
      } catch {
        return
      } finally {
        setLoading(false)
      }
    }
    setOpen(nextOpen)
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => void activate()}
        aria-expanded={isDir ? open : undefined}
        aria-current={current || undefined}
        aria-busy={loading || undefined}
        className={cn(
          'flex h-[var(--tree-row-h)] w-full cursor-pointer items-center gap-1 rounded-sm px-1 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring',
          current && 'bg-accent/70',
        )}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {isDir ? (
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
      {isDir && open && node.children && (
        <ul>
          {node.children.map((c) => (
            <TreeNode
              key={c.path}
              node={c}
              depth={depth + 1}
              currentPath={currentPath}
              onExpand={onExpand}
              onSelect={onSelect}
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
  onRefresh,
  onSelect,
}: FileTreeProps) {
  const t = useT()
  const modified = React.useMemo(() => {
    let n = 0
    const walk = (f: FileNode) => {
      if (f.status) n++
      f.children?.forEach(walk)
    }
    walk(root)
    return n
  }, [root])

  return (
    <div className="flex h-full flex-col">
      {onRefresh ? (
        <div className="flex items-start gap-1 border-b border-border px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-caption font-medium text-foreground">{workspaceName}</p>
            <p className="mt-0.5 text-micro text-muted-foreground">
              {workingTreeLabel ?? t('inspector.files.workingTree')} · {t('inspector.files.modifiedSummary', { count: modifiedCount ?? modified })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('inspector.refresh')}
            title={t('inspector.refresh')}
            onClick={onRefresh}
          >
            <TbRefresh aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="border-b border-border px-2.5 py-2">
          <p className="truncate text-caption font-medium text-foreground">{workspaceName}</p>
          <p className="mt-0.5 text-micro text-muted-foreground">
            {workingTreeLabel ?? t('inspector.files.workingTree')} · {t('inspector.files.modifiedSummary', { count: modifiedCount ?? modified })}
          </p>
        </div>
      )}
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto p-1">
        <ul aria-label={t('inspector.tab.files')}>
          {root.children?.map((c) => (
            <TreeNode
              key={c.path}
              node={c}
              depth={0}
              currentPath={currentPath}
              onExpand={onExpand}
              onSelect={onSelect}
            />
          ))}
          {root.truncated && (
            <li className="px-2 py-1 font-mono text-micro text-muted-foreground">
              {t('inspector.files.truncated')}
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
