import * as React from 'react'
import { useT } from '@/i18n'
import { createDefaultWorkspaceAdapter } from '@/renderer/adapters/workspace-adapter'
import type { ConversationScope } from '@/shared/conversation-scope'
import { TerminalWorkspace, type TerminalCreateRequest } from './TerminalWorkspace'
export type { TerminalCreateRequest } from './TerminalWorkspace'

function ownerKey(scope: ConversationScope) {
  return scope.kind === 'project' ? scope.workspaceId : 'projectless'
}

/**
 * The terminal tab's content, in either dock. Each project's terminals stay
 * mounted once visited: a live PTY is not a screen snapshot.
 */
export function TerminalTabContent({ visible, scope, scopeName, projectIds, onOpenTerminalSettings, hosts, newSessionRequest, createRequest, onCreateRequestHandled }: {
  visible: boolean
  /** The dock's strip and header, where terminals show as tabs (Codex). */
  hosts?: React.ComponentProps<typeof TerminalWorkspace>['hosts']
  newSessionRequest?: number
  createRequest?: TerminalCreateRequest
  onCreateRequestHandled?(id: number): void
  scope: ConversationScope
  scopeName: string
  projectIds: readonly string[]
  onOpenTerminalSettings: () => void
}) {
  const t = useT()
  const [adapter] = React.useState(createDefaultWorkspaceAdapter)
  const [owners, setOwners] = React.useState<Array<{ scope: ConversationScope; name: string }>>([])
  const handledRequests = React.useRef(new Set<number>())
  const owner = ownerKey(scope)
  const observedNewSession = React.useRef(newSessionRequest)
  const ownerNewSessions = React.useRef(new Map<string, number | undefined>())
  // A global strip button emits a number, but the request belongs only to the
  // project active at that moment. Returning to another project must not replay it.
  if (observedNewSession.current !== newSessionRequest) {
    observedNewSession.current = newSessionRequest
    ownerNewSessions.current.set(owner, newSessionRequest)
  }
  const projectKey = JSON.stringify(projectIds)
  const acknowledgeCreate = React.useCallback((id: number) => {
    handledRequests.current.add(id)
    onCreateRequestHandled?.(id)
  }, [onCreateRequestHandled])

  React.useEffect(() => {
    // A user navigation supersedes a queued open in the previous project.
    if (createRequest && ownerKey(createRequest.scope) !== owner && !handledRequests.current.has(createRequest.id)) acknowledgeCreate(createRequest.id)
  }, [createRequest, owner, acknowledgeCreate])

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
      newSessionRequest={ownerNewSessions.current.get(ownerKey(item.scope))}
      createRequest={createRequest && !handledRequests.current.has(createRequest.id) && ownerKey(createRequest.scope) === owner && owner === ownerKey(item.scope) ? createRequest : undefined}
      onCreateRequestHandled={acknowledgeCreate}
    />)}
  </div>
}
