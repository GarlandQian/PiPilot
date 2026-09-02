import type {
  WorkspacePathSearchEntry,
  WorkspacePathSearchResult,
} from '@/shared/workspace-content'

export type FileTreeSearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ready'
      entries: readonly WorkspacePathSearchEntry[]
      truncated: boolean
    }
  | { status: 'error' }

export type FileTreeSearchAction =
  | { type: 'preview'; path: string }
  | { type: 'search'; query: string }

export function normalizeFileTreeSearchQuery(query: string) {
  return query.trim().slice(0, 512)
}

export function projectFileTreeSearchResult(
  workspaceId: string,
  query: string,
  result: WorkspacePathSearchResult,
): Extract<FileTreeSearchState, { status: 'ready' }> | null {
  if (result.workspaceId !== workspaceId || result.query !== query) return null
  return {
    status: 'ready',
    entries: result.entries,
    truncated: result.truncated,
  }
}

export function fileTreeSearchAction(
  entry: WorkspacePathSearchEntry,
): FileTreeSearchAction {
  return entry.type === 'file'
    ? { type: 'preview', path: entry.path }
    : { type: 'search', query: `${entry.path}/` }
}
