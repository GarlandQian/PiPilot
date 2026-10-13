import {
  type ConversationScope,
  type OfficialPiSessionSummary,
  type SessionCatalogListResult,
} from '@/shared/conversation-scope'
import type { PiPilotApi } from '@/shared/pipilot-api'

type SessionCatalogApi = Pick<PiPilotApi['sessionCatalog'], 'list' | 'refresh'>

export interface LoadedSessionCatalog {
  status: SessionCatalogListResult['status']
  rows: OfficialPiSessionSummary[]
}

export interface WorkspaceAdapter {
  readonly mode: 'electron'
  readonly conversation: PiPilotApi['conversation']
  readonly conversationImport: PiPilotApi['conversationImport']
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
  while (page.nextCursor) {
    if (seenCursors.has(page.nextCursor)) {
      throw new Error('The session catalog returned a repeated continuation cursor.')
    }
    seenCursors.add(page.nextCursor)
    page = await catalog.list(scope, page.nextCursor)
    if (!sameScope(page.scope, scope)) {
      throw new Error('The session catalog returned rows for another conversation scope.')
    }
    if (page.status !== 'ready') return { status: page.status, rows: [] }
    rows.push(...page.rows)
  }

  return { status: 'ready', rows }
}

export interface WorkspacePresentation {
  workspaceId: string
  filesModified?: number
  branch?: string
}

/** Header decorations cannot reject a successful project/session activation. */
export async function loadWorkspacePresentation(adapter: {
  files: Pick<PiPilotApi['files'], 'list'>
  changes: Pick<PiPilotApi['changes'], 'list'>
}, workspaceId: string): Promise<WorkspacePresentation> {
  const [directory, changes] = await Promise.allSettled([
    Promise.resolve().then(() => adapter.files.list(workspaceId, '.')),
    Promise.resolve().then(() => adapter.changes.list(workspaceId)),
  ])
  // The inspector owns its own read/error/retry UI. Preserve the last known
  // decoration when its background scan races Git or the filesystem.
  return {
    workspaceId,
    ...(directory.status === 'fulfilled' && directory.value.workspaceId === workspaceId
      ? { filesModified: directory.value.modifiedCount } : {}),
    ...(changes.status === 'fulfilled' && changes.value.workspaceId === workspaceId
      ? { branch: changes.value.branch } : {}),
  }
}

/** A delayed scan can update only the project that requested it. */
export function applyWorkspacePresentation<T extends { workspace: { id: string; branch: string } | null; filesModified: number }>(
  current: T,
  presentation: WorkspacePresentation,
): T {
  if (!current.workspace || current.workspace.id !== presentation.workspaceId) return current
  const filesModified = presentation.filesModified ?? current.filesModified
  const branch = presentation.branch ?? current.workspace.branch
  if (filesModified === current.filesModified && branch === current.workspace.branch) return current
  return { ...current, filesModified, workspace: { ...current.workspace, branch } }
}

export function createDefaultWorkspaceAdapter(): WorkspaceAdapter | null {
  if (typeof window === 'undefined' || !window.pipilot) return null
  return {
    mode: 'electron',
    conversation: window.pipilot.conversation,
    conversationImport: window.pipilot.conversationImport,
    localPi: window.pipilot.localPi,
    workspace: window.pipilot.workspace,
    files: window.pipilot.files,
    changes: window.pipilot.changes,
    terminal: window.pipilot.terminal,
    sessionCatalog: window.pipilot.sessionCatalog,
  }
}
