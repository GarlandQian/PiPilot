import * as React from 'react'
import { TbAt, TbExternalLink, TbGitCompare, TbTerminal2 } from 'react-icons/tb'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useT } from '@/i18n'
import type { WorkspacePathSearchEntry } from '@/shared/workspace-content'
import { terminalDirectoryForEntry, useTerminalActions } from './TerminalActions'

/** Tree rows, search results and open file tabs share the same reference action. */
export function WorkspacePathContextMenu({ children, entry, onAddToComposer, onShowChanges }: {
  children: React.ReactElement
  entry: WorkspacePathSearchEntry
  onAddToComposer?: (entry: WorkspacePathSearchEntry) => void
  onShowChanges?: (path: string) => void
}) {
  const t = useT()
  const terminal = useTerminalActions()
  const keepComposerFocus = React.useRef(false)
  if (!terminal && !onAddToComposer && (!onShowChanges || entry.type !== 'file')) return children
  return <ContextMenu>
    <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
    <ContextMenuContent onCloseAutoFocus={(event) => {
      if (!keepComposerFocus.current) return
      keepComposerFocus.current = false
      event.preventDefault()
    }}>
      {onAddToComposer ? <ContextMenuItem onSelect={() => {
        keepComposerFocus.current = true
        onAddToComposer(entry)
      }}>
        <TbAt aria-hidden />{t('inspector.files.addToComposer')}
      </ContextMenuItem> : null}
      {onShowChanges && entry.type === 'file' ? <ContextMenuItem onSelect={() => {
        keepComposerFocus.current = true
        onShowChanges(entry.path)
      }}><TbGitCompare aria-hidden />{t('inspector.files.showChanges')}</ContextMenuItem> : null}
      {terminal ? <>
        <ContextMenuItem onSelect={() => terminal.open(terminal.scope, terminalDirectoryForEntry(entry))}>
          <TbTerminal2 aria-hidden />{t('terminal.context.openHere')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => terminal.openExternal(terminal.scope, terminalDirectoryForEntry(entry))}>
          <TbExternalLink aria-hidden />{t('terminal.context.openExternalHere')}
        </ContextMenuItem>
      </> : null}
    </ContextMenuContent>
  </ContextMenu>
}
