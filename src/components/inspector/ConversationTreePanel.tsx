import * as React from 'react'
import { TbBookmark, TbBookmarkFilled, TbDots, TbGitBranch, TbLoader2, TbPencil, TbArrowRight, TbListDetails } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { FormActions, SettingsField, SettingsSheet } from '@/components/settings/kit'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { branchLeaf, isUserMessage, questionSiblings, userMessageText, type ConversationTree } from '@/renderer/pi-rpc/conversation-tree'

interface Node { id: string; text: string; level: number; onPath: boolean; current: boolean; label?: string }

/** The questions of every branch, indented one step at each place a question was asked again. */
function questionNodes(tree: ConversationTree): Node[] {
  const levels = new Map<string | null, number>([[null, 0]])
  const nodes: Node[] = []
  const lastOnPath = [...tree.path].find((id) => { const row = tree.byId.get(id); return row ? isUserMessage(row) : false })
  for (const row of [...tree.rows].sort((left, right) => left.order - right.order)) {
    const parentLevel = levels.get(row.parentId) ?? 0
    let level = parentLevel
    if (isUserMessage(row)) {
      const siblings = questionSiblings(tree, row.id)
      // The first of several questions stays in line; later ones step in.
      if (siblings && siblings.index > 0) level = parentLevel + 1
      nodes.push({ id: row.id, text: userMessageText(row), level, onPath: tree.path.has(row.id), current: row.id === lastOnPath,
        ...(row.label ? { label: row.label } : {}) })
    }
    levels.set(row.id, level)
  }
  return nodes
}

function LabelSheet({ open, initial, onOpenChange, onSave }: { open: boolean; initial: string; onOpenChange(open: boolean): void; onSave(label: string): void }) {
  const t = useT()
  const [value, setValue] = React.useState(initial)
  const id = React.useId()
  React.useEffect(() => { if (open) setValue(initial) }, [initial, open])
  const save = () => { if (value.trim()) { onSave(value.trim()); onOpenChange(false) } }
  return <SettingsSheet open={open} onOpenChange={onOpenChange} title={t('branches.bookmarkTitle')} description={t('branches.bookmarkDescription')}
    footer={<FormActions onCancel={() => onOpenChange(false)} onSave={save} canSave={Boolean(value.trim())} saveLabel={t('branches.bookmarkSave')} />}>
    <SettingsField label={t('branches.bookmarkName')} htmlFor={id}>
      <Input id={id} value={value} maxLength={120} autoFocus onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); save() } }} />
    </SettingsField>
  </SettingsSheet>
}

/**
 * Pi's /tree as a tab: every branch of this conversation (they share one
 * session file), switching between them, and bookmarks. Switching never
 * deletes a branch; summarizing first carries what was left behind along.
 */
export function ConversationTreePanel({ tree, busy, onSwitch, onEdit, onLabel }: {
  tree: ConversationTree | null
  busy: boolean
  onSwitch(leafId: string, summarize: boolean): Promise<void>
  onEdit(entryId: string): Promise<void>
  onLabel(entryId: string, label: string | null): Promise<void>
}) {
  const t = useT()
  const [onlyBookmarks, setOnlyBookmarks] = React.useState(false)
  const [labeling, setLabeling] = React.useState<{ id: string; initial: string } | null>(null)
  const [working, setWorking] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const nodes = React.useMemo(() => tree ? questionNodes(tree) : [], [tree])
  const visible = onlyBookmarks ? nodes.filter((node) => node.label) : nodes
  const branchCount = React.useMemo(() => tree ? tree.rows.filter((row) => (tree.children.get(row.id) ?? []).length === 0).length : 0, [tree])
  const run = (id: string, operation: () => Promise<void>) => {
    setWorking(id); setError(null)
    void operation().catch((caught: unknown) => setError(caught instanceof Error && caught.message ? caught.message : t('branches.failed'))).finally(() => setWorking(null))
  }
  const disabled = busy || working !== null

  return <div className="flex h-full min-h-0 flex-col" data-conversation-tree>
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
      <TbGitBranch className="size-4 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">{t('branches.summary', { count: Math.max(branchCount, nodes.length ? 1 : 0) })}</span>
      <Button variant={onlyBookmarks ? 'secondary' : 'ghost'} size="sm" aria-pressed={onlyBookmarks} onClick={() => setOnlyBookmarks((value) => !value)}>
        <TbBookmark aria-hidden />{t('branches.onlyBookmarks')}
      </Button>
    </div>
    {error ? <p role="alert" className="mx-3 mt-2 rounded-[10px] bg-destructive/8 px-3 py-2 text-caption text-destructive">{error}</p> : null}
    {busy ? <p className="mx-3 mt-2 text-caption text-muted-foreground">{t('branches.busy')}</p> : null}
    <ol className="scroll-slim min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {!tree ? <li className="flex items-center justify-center gap-2 py-8 text-caption text-muted-foreground"><TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />{t('branches.loading')}</li>
        : visible.length === 0 ? <li className="px-3 py-8 text-center text-caption text-muted-foreground">{t(onlyBookmarks ? 'branches.noBookmarks' : 'branches.empty')}</li>
          : visible.map((node) => <li key={node.id} data-tree-node={node.id} data-tree-on-path={node.onPath || undefined}
            className={cn('group/node flex min-w-0 items-center gap-1.5 rounded-[8px] py-1 pr-1 hover:bg-fill', node.current && 'bg-fill-strong')}
            style={{ paddingLeft: `${8 + Math.min(node.level, 8) * 14}px` }}>
            <span className={cn('size-1.5 shrink-0 rounded-full', node.onPath ? 'bg-primary' : 'bg-muted-foreground/40')} aria-hidden />
            <button type="button" disabled={disabled} className="min-w-0 flex-1 text-left outline-none focus-visible:focus-ring disabled:cursor-default"
              title={node.text} onClick={() => tree && !node.onPath && run(node.id, () => onSwitch(branchLeaf(tree, node.id), false))}>
              {node.label ? <span className="flex items-center gap-1 text-micro font-medium text-primary"><TbBookmarkFilled className="size-3" aria-hidden />{node.label}</span> : null}
              <span className={cn('block truncate text-caption', node.onPath ? 'text-foreground' : 'text-muted-foreground')}>{node.text || t('branches.untitled')}</span>
            </button>
            {working === node.id ? <TbLoader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden /> : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground opacity-0 group-hover/node:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                aria-label={t('branches.actions')}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={disabled || node.onPath} onSelect={() => tree && run(node.id, () => onSwitch(branchLeaf(tree, node.id), false))}><TbArrowRight aria-hidden />{t('branches.switch')}</DropdownMenuItem>
                <DropdownMenuItem disabled={disabled || node.onPath} onSelect={() => tree && run(node.id, () => onSwitch(branchLeaf(tree, node.id), true))}><TbListDetails aria-hidden />{t('branches.switchSummarized')}</DropdownMenuItem>
                <DropdownMenuItem disabled={disabled} onSelect={() => run(node.id, () => onEdit(node.id))}><TbPencil aria-hidden />{t('branches.editFromHere')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={disabled} onSelect={() => setLabeling({ id: node.id, initial: node.label ?? '' })}><TbBookmark aria-hidden />{t(node.label ? 'branches.renameBookmark' : 'branches.addBookmark')}</DropdownMenuItem>
                {node.label ? <DropdownMenuItem disabled={disabled} onSelect={() => run(node.id, () => onLabel(node.id, null))}>{t('branches.removeBookmark')}</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>)}
    </ol>
    <LabelSheet open={labeling !== null} initial={labeling?.initial ?? ''} onOpenChange={(open) => { if (!open) setLabeling(null) }}
      onSave={(label) => { const target = labeling; if (target) run(target.id, () => onLabel(target.id, label)) }} />
  </div>
}
