import {
  SESSION_CATALOG_MAX_CANDIDATES,
  SESSION_CATALOG_MAX_PAGE_ROWS,
  type ConversationScope,
  type OfficialPiSessionSummary,
  type SessionCatalogListResult,
} from '@/shared/conversation-scope'
import type { PiPilotApi } from '@/shared/pipilot-api'

const SESSION_CATALOG_MAX_PAGES = Math.ceil(
  SESSION_CATALOG_MAX_CANDIDATES / SESSION_CATALOG_MAX_PAGE_ROWS,
)

type SessionCatalogApi = Pick<PiPilotApi['sessionCatalog'], 'list' | 'refresh'>

export interface LoadedSessionCatalog {
  status: SessionCatalogListResult['status']
  rows: OfficialPiSessionSummary[]
}

export interface WorkspaceAdapter {
  readonly mode: 'electron'
  readonly conversation: PiPilotApi['conversation']
  readonly localPi: PiPilotApi['localPi']
  readonly workspace: PiPilotApi['workspace']
  readonly files: PiPilotApi['files']
  readonly changes: PiPilotApi['changes']
  readonly terminal: PiPilotApi['terminal']
  readonly sessionCatalog: PiPilotApi['sessionCatalog']
}

function sameScope(left: ConversationScope, right: ConversationScope) {
  return left.kind === right.kind && (
    left.kind === 'projectless' || (
      right.kind === 'project' && left.workspaceId === right.workspaceId
    )
  )
}

export async function loadOfficialSessionCatalog(
  catalog: SessionCatalogApi,
  scope: ConversationScope,
  refresh = false,
): Promise<LoadedSessionCatalog> {
  let page = refresh
    ? await catalog.refresh(scope)
    : await catalog.list(scope)
  if (!sameScope(page.scope, scope)) {
    throw new Error('The session catalog returned rows for another conversation scope.')
  }
  if (page.status !== 'ready') return { status: page.status, rows: [] }

  const rows = [...page.rows]
  const seenCursors = new Set<string>()
  let pageCount = 1
  while (
    page.nextCursor &&
    pageCount < SESSION_CATALOG_MAX_PAGES &&
    !seenCursors.has(page.nextCursor)
  ) {
    seenCursors.add(page.nextCursor)
    page = await catalog.list(scope, page.nextCursor)
    if (!sameScope(page.scope, scope)) {
      throw new Error('The session catalog returned rows for another conversation scope.')
    }
    if (page.status !== 'ready') return { status: page.status, rows: [] }
    rows.push(...page.rows)
    pageCount += 1
  }

  return { status: 'ready', rows }
}

export function createDefaultWorkspaceAdapter(): WorkspaceAdapter | null {
  if (typeof window === 'undefined' || !window.pipilot) return null
  return {
    mode: 'electron',
    conversation: window.pipilot.conversation,
    localPi: window.pipilot.localPi,
    workspace: window.pipilot.workspace,
    files: window.pipilot.files,
    changes: window.pipilot.changes,
    terminal: window.pipilot.terminal,
    sessionCatalog: window.pipilot.sessionCatalog,
  }
}
