import { createContext, useContext } from 'react'
import type { ConversationScope } from '@/shared/conversation-scope'
import type { WorkspacePathSearchEntry } from '@/shared/workspace-content'

export interface TerminalActions {
  scope: ConversationScope
  open(scope: ConversationScope, relativeDirectory?: string): void
  openExternal(scope: ConversationScope, relativeDirectory?: string): void
}

/** Project rows and file menus use the same scoped opening actions. */
export const TerminalActionsContext = createContext<TerminalActions | null>(null)
export const useTerminalActions = () => useContext(TerminalActionsContext)

export function terminalDirectoryForEntry(entry: Pick<WorkspacePathSearchEntry, 'path' | 'type'>) {
  if (entry.type === 'dir') return entry.path
  const separator = entry.path.lastIndexOf('/')
  return separator < 0 ? '.' : entry.path.slice(0, separator)
}
