import * as React from 'react'
import { TbCopy, TbExternalLink, TbWorld } from 'react-icons/tb'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { primaryShortcut } from '@/lib/keyboard-shortcuts'
import { useT } from '@/i18n'
import type { ConversationScope } from '@/shared/conversation-scope'
import { isTerminalLinkModifier, normalizeTerminalLink } from './terminal-links'

export type TerminalLinkTarget = NonNullable<ReturnType<typeof normalizeTerminalLink>>

export const TerminalLinksContext = React.createContext<{
  scope: ConversationScope
  openInternal(scope: ConversationScope, url: string): Promise<void>
} | null>(null)

export function useTerminalLinkActions(onError: (message: string) => void, scope?: ConversationScope) {
  const context = React.useContext(TerminalLinksContext)
  const t = useT()
  const open = async (target: TerminalLinkTarget, internal = false) => {
    const safe = normalizeTerminalLink(target.text)
    if (!safe) return
    try {
      if (internal && context) await context.openInternal(scope ?? context.scope, safe.url)
      else await window.pipilot!.shell.openExternal(safe.url)
    } catch { onError(t('terminal.link.openFailed')) }
  }
  const copy = async (target: TerminalLinkTarget) => {
    try { await navigator.clipboard.writeText(target.text) }
    catch { onError(t('md.copyFailed')) }
  }
  return { open, copy, canOpenInternal: Boolean(context), hint: t('terminal.link.hint', { shortcut: primaryShortcut(t('terminal.link.click')) }) }
}

export function TerminalLinkMenuItems({ target, actions }: {
  target: TerminalLinkTarget
  actions: ReturnType<typeof useTerminalLinkActions>
}) {
  const t = useT()
  return <>
    <ContextMenuItem onSelect={() => void actions.open(target)}><TbExternalLink aria-hidden />{t('terminal.link.openExternal')}</ContextMenuItem>
    {actions.canOpenInternal ? <ContextMenuItem onSelect={() => void actions.open(target, true)}><TbWorld aria-hidden />{t('terminal.link.openInternal')}</ContextMenuItem> : null}
    <ContextMenuItem onSelect={() => void actions.copy(target)}><TbCopy aria-hidden />{t('terminal.link.copy')}</ContextMenuItem>
  </>
}

/** Log output keeps its literal text, ANSI styling and selection behavior. */
export function TerminalTextLink({ target, children, onError, scope }: {
  target: TerminalLinkTarget
  children: React.ReactNode
  onError(message: string): void
  scope?: ConversationScope
}) {
  const actions = useTerminalLinkActions(onError, scope)
  return <ContextMenu>
    <ContextMenuTrigger asChild onContextMenu={(event) => event.stopPropagation()}>
      <a href={target.url} title={`${target.text}\n${actions.hint}`} data-terminal-link={target.text}
        className="rounded-sm text-inherit decoration-current underline-offset-2 hover:underline focus-visible:focus-ring"
        onClick={(event) => {
          event.preventDefault()
          // Enter activates a focused link; a mouse gesture needs the primary modifier.
          if (event.detail !== 0 && !isTerminalLinkModifier(event, navigator.userAgent)) return
          if (event.detail !== 0 && window.getSelection()?.toString()) return
          void actions.open(target)
        }} onAuxClick={(event) => event.preventDefault()}>
        {children}
      </a>
    </ContextMenuTrigger>
    <ContextMenuContent><TerminalLinkMenuItems target={target} actions={actions} /></ContextMenuContent>
  </ContextMenu>
}
