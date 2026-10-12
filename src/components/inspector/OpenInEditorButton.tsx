import * as React from 'react'
import { TbAppWindow, TbCheck, TbChevronDown, TbExternalLink, TbFolder, TbTerminal2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { fileManagerNameKey } from '@/lib/platform-labels'
import { cn } from '@/lib/utils'
import { isAvailable, useOpenTargets, type OpenTarget } from '@/renderer/open-targets'
import type { TerminalExternalApp } from '@/shared/terminal-profiles'

export function OpenTargetIcon({ target, className }: { target: OpenTarget; className?: string }) {
  if (target.icon) return <img src={target.icon} alt="" aria-hidden className={cn('size-4 shrink-0', className)} draggable={false} />
  const Icon = target.group === 'terminal' ? TbTerminal2
    : target.group === 'other' ? target.editor.kind === 'file-manager' ? TbFolder : TbExternalLink : TbAppWindow
  return <Icon aria-hidden className={cn('size-4 shrink-0', className)} />
}

/** The system terminals go by their localized names (终端, 命令提示符); other apps keep their own. */
export function useTerminalAppName() {
  const t = useT()
  return React.useCallback((app: Pick<TerminalExternalApp, 'label' | 'source' | 'adapter'>) => app.source !== 'detected' ? app.label
    : app.adapter === 'mac-terminal' ? t('editors.macTerminal') : app.adapter === 'windows-cmd' ? t('editors.windowsCmd') : app.label, [t])
}

export function useOpenTargetName() {
  const t = useT()
  const terminalName = useTerminalAppName()
  return React.useCallback((target: OpenTarget) => target.group === 'terminal' ? terminalName(target.app) : target.group === 'editor' ? target.name
    : target.editor.kind === 'system' ? t('editors.system') : t(fileManagerNameKey()), [t, terminalName])
}

/**
 * Codex's "Open in": the main part opens in the default app (the last one
 * used), the chevron lists every editor and terminal found on this computer,
 * then the default app and the file manager. Without `path` it opens the project.
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
  const { targets, preferred, open, refresh } = useOpenTargets()
  const nameOf = useOpenTargetName()
  const [failed, setFailed] = React.useState<string | null>(null)
  React.useEffect(() => { if (failed) { const timer = setTimeout(() => setFailed(null), 4_000); return () => clearTimeout(timer) } }, [failed])
  const run = (target: OpenTarget) => {
    setFailed(null)
    void open(workspaceId, target, { ...(path ? { path } : {}), ...(line ? { line } : {}) }).catch(() => setFailed(t('editors.failed', { name: nameOf(target) })))
  }
  if (!preferred) return null
  const groups = (['editor', 'terminal', 'other'] as const)
    .map((group) => targets.filter((target) => target.group === group && isAvailable(target)))
    .filter((group) => group.length)
  const label = t('editors.openIn', { name: nameOf(preferred) })
  return <div className={cn('relative flex shrink-0 items-center', variant === 'labelled' && 'rounded-[8px] shadow-[inset_0_0_0_0.5px_var(--color-border)]', className)} data-open-in-editor>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size={variant === 'icon' ? 'icon-sm' : 'xs'} onClick={() => run(preferred)} aria-label={label}
          className={cn(variant === 'labelled' ? 'h-6 gap-1.5 rounded-r-none px-2 text-caption' : 'rounded-r-none pr-0.5')}>
          <OpenTargetIcon target={preferred} className={variant === 'labelled' ? 'size-3.5' : undefined} />
          {variant === 'labelled' ? <span className="max-w-28 truncate">{nameOf(preferred)}</span> : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{failed ?? label}</TooltipContent>
    </Tooltip>
    {/* Each opening rescans, so an app installed meanwhile appears (Codex). */}
    <DropdownMenu onOpenChange={(next) => { if (next) void refresh() }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={t('editors.openWith')} title={t('editors.openWith')}
          className={cn(variant === 'labelled' ? 'h-6 w-5 rounded-l-none' : 'w-4 rounded-l-none text-muted-foreground')}>
          <TbChevronDown className="size-3" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52" data-open-in-menu>
        <DropdownMenuLabel>{t('editors.openWith')}</DropdownMenuLabel>
        {groups.map((group, index) => <React.Fragment key={group[0]!.group}>
          {index ? <DropdownMenuSeparator /> : null}
          {group.map((target) => <DropdownMenuItem key={target.id} onSelect={() => run(target)} data-open-target={target.id} data-open-target-group={target.group}>
            <OpenTargetIcon target={target} />
            <span className="min-w-0 flex-1 truncate">{nameOf(target)}</span>
            {target.id === preferred.id ? <TbCheck className="text-muted-foreground" aria-hidden /> : null}
          </DropdownMenuItem>)}
        </React.Fragment>)}
      </DropdownMenuContent>
    </DropdownMenu>
    {failed ? <span role="alert" className="sr-only">{failed}</span> : null}
  </div>
}
