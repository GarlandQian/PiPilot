import * as React from 'react'
import { useT } from '@/i18n'
import { createDefaultWorkspaceAdapter } from '@/renderer/adapters/workspace-adapter'
import type { ConversationScope } from '@/shared/conversation-scope'
import { TerminalWorkspace } from './TerminalWorkspace'

function ownerKey(scope: ConversationScope) {
  return scope.kind === 'project' ? scope.workspaceId : 'projectless'
}

/**
 * The terminal tab's content, in either dock. Each project's terminals stay
 * mounted once visited: a live PTY is not a screen snapshot.
 */
export function TerminalTabContent({ visible, scope, scopeName, projectIds, onOpenTerminalSettings, hosts, newSessionRequest }: {
  visible: boolean
  /** The dock's strip and header, where terminals show as tabs (Codex). */
  hosts?: React.ComponentProps<typeof TerminalWorkspace>['hosts']
  newSessionRequest?: number
  scope: ConversationScope
  scopeName: string
  projectIds: readonly string[]
  onOpenTerminalSettings: () => void
}) {
  const t = useT()
  const [adapter] = React.useState(createDefaultWorkspaceAdapter)
  const [owners, setOwners] = React.useState<Array<{ scope: ConversationScope; name: string }>>([])
  const owner = ownerKey(scope)
  const projectKey = JSON.stringify(projectIds)

  React.useEffect(() => {
    if (!visible) return
    setOwners((current) => {
      const existing = current.find((item) => ownerKey(item.scope) === owner)
      if (existing?.name === scopeName) return current
      return existing
        ? current.map((item) => item === existing ? { ...item, name: scopeName } : item)
        : [...current, { scope, name: scopeName }]
    })
  }, [visible, owner, scope, scopeName])

  React.useEffect(() => {
    const ids = new Set<string>(JSON.parse(projectKey))
    setOwners((current) => {
      const retained = current.filter((item) => item.scope.kind === 'projectless' || ids.has(item.scope.workspaceId))
      return retained.length === current.length ? current : retained
    })
  }, [projectKey])

  if (!adapter) return <p role="status" className="p-4 text-caption text-muted-foreground">{t('inspector.terminal.error')}</p>
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar" data-terminal-tab>
    {owners.map((item) => <TerminalWorkspace
      key={ownerKey(item.scope)}
      terminalApi={adapter.terminal}
      scope={item.scope}
      name={item.name}
      visible={visible && ownerKey(item.scope) === owner}
      maximized={false}
      onOpenTerminalSettings={onOpenTerminalSettings}
      // Only the current project's terminals appear in the strip.
      hosts={ownerKey(item.scope) === owner ? hosts : undefined}
      newSessionRequest={ownerKey(item.scope) === owner ? newSessionRequest : undefined}
    />)}
  </div>
}
