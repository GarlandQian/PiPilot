import * as React from 'react'
import { TbAppWindow, TbCheck, TbChevronDown, TbExternalLink, TbFolder } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { fileManagerNameKey } from '@/lib/platform-labels'
import { cn } from '@/lib/utils'
import { useExternalEditors } from '@/renderer/external-editors'
import type { ExternalEditor } from '@/shared/external-editors'

function EditorIcon({ editor, className }: { editor: ExternalEditor; className?: string }) {
  if (editor.icon) return <img src={editor.icon} alt="" aria-hidden className={cn('size-4 shrink-0', className)} draggable={false} />
  const Icon = editor.kind === 'file-manager' ? TbFolder : editor.kind === 'system' ? TbExternalLink : TbAppWindow
  return <Icon aria-hidden className={cn('size-4 shrink-0', className)} />
}

export function useEditorName() {
  const t = useT()
  return React.useCallback((editor: ExternalEditor) => editor.kind === 'system' ? t('editors.system')
    : editor.kind === 'file-manager' ? t(fileManagerNameKey()) : editor.name, [t])
}

/**
 * Codex's "Open in": the main part opens in the default editor (the last one
 * used), the chevron lists every editor found on this computer, the default
 * app and the file manager. Without `path` it opens the project.
 */
export function OpenInEditorButton({ workspaceId, path, line, variant = 'labelled', className }: {
  workspaceId: string
  path?: string
  line?: number
  /** `icon`: the toolbar's compact form. */
  variant?: 'labelled' | 'icon'
  className?: string
}) {
  const t = useT()
  const { editors, preferred, open } = useExternalEditors()
  const nameOf = useEditorName()
  const [failed, setFailed] = React.useState<string | null>(null)
  React.useEffect(() => { if (failed) { const timer = setTimeout(() => setFailed(null), 4_000); return () => clearTimeout(timer) } }, [failed])
  const run = (editor: ExternalEditor) => {
    setFailed(null)
    void open(workspaceId, editor, { ...(path ? { path } : {}), ...(line ? { line } : {}) }).catch(() => setFailed(t('editors.failed', { name: nameOf(editor) })))
  }
  if (!preferred) return null
  const apps = editors.filter((editor) => editor.kind === 'editor')
  const others = editors.filter((editor) => editor.kind !== 'editor')
  const label = t('editors.openIn', { name: nameOf(preferred) })
  return <div className={cn('relative flex shrink-0 items-center', variant === 'labelled' && 'rounded-[8px] shadow-[inset_0_0_0_0.5px_var(--color-border)]', className)} data-open-in-editor>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size={variant === 'icon' ? 'icon-sm' : 'xs'} onClick={() => run(preferred)} aria-label={label}
          className={cn(variant === 'labelled' ? 'h-6 gap-1.5 rounded-r-none px-2 text-caption' : 'rounded-r-none pr-0.5')}>
          <EditorIcon editor={preferred} className={variant === 'labelled' ? 'size-3.5' : undefined} />
          {variant === 'labelled' ? <span className="max-w-28 truncate">{nameOf(preferred)}</span> : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{failed ?? label}</TooltipContent>
    </Tooltip>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={t('editors.openWith')} title={t('editors.openWith')}
          className={cn(variant === 'labelled' ? 'h-6 w-5 rounded-l-none' : 'w-4 rounded-l-none text-muted-foreground')}>
          <TbChevronDown className="size-3" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>{t('editors.openWith')}</DropdownMenuLabel>
        {apps.map((editor) => <DropdownMenuItem key={editor.id} onSelect={() => run(editor)}>
          <EditorIcon editor={editor} />
          <span className="min-w-0 flex-1 truncate">{nameOf(editor)}</span>
          {editor.id === preferred.id ? <TbCheck className="text-muted-foreground" aria-hidden /> : null}
        </DropdownMenuItem>)}
        {apps.length && others.length ? <DropdownMenuSeparator /> : null}
        {others.map((editor) => <DropdownMenuItem key={editor.id} onSelect={() => run(editor)}>
          <EditorIcon editor={editor} />
          <span className="min-w-0 flex-1 truncate">{nameOf(editor)}</span>
          {editor.id === preferred.id ? <TbCheck className="text-muted-foreground" aria-hidden /> : null}
        </DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
    {failed ? <span role="alert" className="sr-only">{failed}</span> : null}
  </div>
}
