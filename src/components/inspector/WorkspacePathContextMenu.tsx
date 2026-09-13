import * as React from 'react'
import { TbAt } from 'react-icons/tb'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useT } from '@/i18n'
import type { WorkspacePathSearchEntry } from '@/shared/workspace-content'

/** Tree rows, search results and open file tabs share the same reference action. */
export function WorkspacePathContextMenu({ children, entry, onAddToComposer }: {
  children: React.ReactElement
  entry: WorkspacePathSearchEntry
  onAddToComposer?: (entry: WorkspacePathSearchEntry) => void
}) {
  const t = useT()
  const keepComposerFocus = React.useRef(false)
  if (!onAddToComposer) return children
  return <ContextMenu>
    <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
    <ContextMenuContent onCloseAutoFocus={(event) => {
      if (!keepComposerFocus.current) return
      keepComposerFocus.current = false
      event.preventDefault()
    }}>
      <ContextMenuItem onSelect={() => {
        keepComposerFocus.current = true
        onAddToComposer(entry)
      }}>
        <TbAt aria-hidden />{t('inspector.files.addToComposer')}
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
}
