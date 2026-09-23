import * as React from 'react'
import { TbAt, TbGitCompare } from 'react-icons/tb'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useT } from '@/i18n'
import type { WorkspacePathSearchEntry } from '@/shared/workspace-content'

/** Tree rows, search results and open file tabs share the same reference action. */
export function WorkspacePathContextMenu({ children, entry, onAddToComposer, onShowChanges }: {
  children: React.ReactElement
  entry: WorkspacePathSearchEntry
  onAddToComposer?: (entry: WorkspacePathSearchEntry) => void
  onShowChanges?: (path: string) => void
}) {
  const t = useT()
  const keepComposerFocus = React.useRef(false)
  if (!onAddToComposer && (!onShowChanges || entry.type !== 'file')) return children
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
    </ContextMenuContent>
  </ContextMenu>
}
