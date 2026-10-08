import type { LocalPiSessionEntry } from '@/shared/local-pi'
import { getConversationBranchEntries } from '@/shared/conversation-task'
import type { WorkspaceChangeSummary } from '@/shared/workspace-content'

/**
 * Codex's review scopes: Unstaged (the default), Staged, one Commit, the
 * Branch since it left the default branch, and the Last turn (what the agent
 * wrote since your last message).
 */
export type DiffScope = 'unstaged' | 'staged' | 'commit' | 'branch' | 'lastTurn'
export const DIFF_SCOPES: readonly DiffScope[] = ['unstaged', 'staged', 'commit', 'branch', 'lastTurn']

const EDIT_TOOLS = new Set(['write', 'edit'])

function normalize(path: string) {
  return path.trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+$/u, '')
}

/** Paths the agent wrote or edited after the latest user message on the active branch. */
export function lastTurnEditedPaths(entries: readonly LocalPiSessionEntry[], leafId: string | null): string[] {
  const branch = getConversationBranchEntries(entries, leafId) ?? []
  let start = -1
  for (const [index, entry] of branch.entries()) {
    if (entry.type === 'message' && entry.message.role === 'user') start = index
  }
  const paths = new Set<string>()
  for (const entry of branch.slice(start + 1)) {
    if (entry.type !== 'message' || entry.message.role !== 'assistant' || typeof entry.message.content === 'string') continue
    for (const block of entry.message.content) {
      if (block.type !== 'toolCall' || !EDIT_TOOLS.has(block.name)) continue
      const args = block.arguments as Record<string, unknown> | undefined
      if (typeof args?.path === 'string' && args.path.trim()) paths.add(normalize(args.path))
    }
  }
  return [...paths]
}

/** Tool paths may be absolute or relative to the project; diff paths are project-relative. */
export function touchedInLastTurn(path: string, edited: readonly string[]) {
  const target = normalize(path)
  return edited.some((candidate) => candidate === target || candidate.endsWith(`/${target}`))
}

export function filterDiffScope<T extends Pick<WorkspaceChangeSummary, 'path' | 'stage'>>(files: readonly T[], scope: DiffScope, edited: readonly string[]): T[] {
  // Branch and Commit read their own lists.
  if (scope === 'branch' || scope === 'commit') return [...files]
  if (scope === 'lastTurn') return files.filter((file) => touchedInLastTurn(file.path, edited))
  return files.filter((file) => file.stage === scope)
}

export function diffScopeCounts(files: readonly Pick<WorkspaceChangeSummary, 'path' | 'stage'>[], edited: readonly string[]): Record<'unstaged' | 'staged' | 'lastTurn', number> {
  const distinct = (items: readonly Pick<WorkspaceChangeSummary, 'path'>[]) => new Set(items.map((item) => item.path)).size
  return {
    unstaged: files.filter((file) => file.stage === 'unstaged').length,
    staged: files.filter((file) => file.stage === 'staged').length,
    lastTurn: distinct(filterDiffScope(files, 'lastTurn', edited)),
  }
}
