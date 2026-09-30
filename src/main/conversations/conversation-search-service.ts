import { randomUUID } from 'node:crypto'
import { lstat, open, realpath } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setImmediate as yieldTask } from 'node:timers/promises'
import { conversationScopeKey } from './conversation-scope-resolver'
import type { OfficialPiSessionCatalog, OfficialPiSessionControlTarget } from './official-pi-session-catalog'
import type { OfficialPiSessionSummary } from '../../shared/conversation-scope'
import {
  conversationSearchInputSchema, findTextMatches, searchSnippet,
  type ConversationSearchHit, type ConversationSearchInput, type ConversationSearchResult,
} from '../../shared/conversation-search'

const MAX_FILE_BYTES = 64 * 1024 * 1024
const MAX_LINE_BYTES = 4 * 1024 * 1024
type Entry = { id: string; parentId: string | null; role?: ConversationSearchHit['role']; toolCallId?: string; text: string }
type Target = { summary: OfficialPiSessionSummary; target: OfficialPiSessionControlTarget }
type Scan = { fingerprint: string; expires: number; targets: Target[]; offset: number; skipped: number; limited: boolean; pending?: Promise<ConversationSearchResult>; result?: ConversationSearchResult }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Only visible message text is indexed; image data, credentials and tool arguments are not. */
export function parseSearchEntry(value: unknown): Entry | null {
  if (!record(value) || typeof value.id !== 'string' || !value.id || value.id.length > 256) return null
  const base: Entry = { id: value.id, parentId: typeof value.parentId === 'string' ? value.parentId : null, text: '' }
  if (value.type !== 'message' || !record(value.message)) return base
  const message = value.message
  if (message.role === 'bashExecution') return { ...base, role: 'toolResult', text: [message.command, message.output].filter((value) => typeof value === 'string').join('\n') }
  if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'toolResult') return base
  const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content)
    ? message.content.filter((block) => record(block) && block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n') : ''
  return { ...base, role: message.role, text, ...(message.role === 'toolResult' && typeof message.toolCallId === 'string' && message.toolCallId.length > 0 && message.toolCallId.length <= 2_048 ? { toolCallId: message.toolCallId } : {}) }
}

export function searchActiveBranch(entries: readonly Entry[], query: string) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const visited = new Set<string>()
  const path: Entry[] = []
  let current: Entry | undefined = entries[entries.length - 1]
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    path.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  const hits: Omit<ConversationSearchHit, 'session'>[] = []
  let anchor: string | null = null
  let limited = false
  for (const entry of path.reverse()) {
    if (entry.role === 'user') anchor = entry.id
    if (!entry.role || !anchor || !entry.text) continue
    for (const match of findTextMatches(entry.text, query, 101)) {
      if (hits.length >= 100) { limited = true; break }
      hits.push({ entryId: entry.id, anchorEntryId: anchor, role: entry.role, ...(entry.toolCallId ? { toolCallId: entry.toolCallId } : {}), ...searchSnippet(entry.text, match.start, match.length) })
    }
  }
  return { hits, limited }
}

async function readSearchEntries(target: OfficialPiSessionControlTarget) {
  const direct = await lstat(target.sessionFile)
  if (!direct.isFile() || direct.isSymbolicLink() || dirname(await realpath(target.sessionFile)) !== target.root) throw new Error('Session unavailable')
  const file = await open(target.sessionFile, 'r')
  try {
    const stat = await file.stat()
    if (Number(stat.dev) !== target.identity.dev || Number(stat.ino) !== target.identity.ino || stat.size > MAX_FILE_BYTES) throw new Error('Session changed or exceeds search limit')
    const entries: Entry[] = []
    let pending = ''
    let headerSeen = false
    let lines = 0
    let limited = false
    let skipLine = false
    const consume = (line: string) => {
      try {
        const value: unknown = JSON.parse(line)
        if (!headerSeen) {
          if (!record(value) || value.type !== 'session' || value.id !== target.sessionId || value.cwd !== target.cwd) throw new Error('Session identity changed')
          headerSeen = true
          return
        }
        const entry = parseSearchEntry(value)
        if (entry) entries.push(entry)
      } catch (error) {
        if (!headerSeen) throw error
        limited = true
      }
    }
    const stream = file.createReadStream({ encoding: 'utf8', autoClose: false, start: 0, end: Math.max(0, stat.size - 1), highWaterMark: 64 * 1024 })
    for await (const chunk of stream) {
      pending += chunk
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        if (!skipLine && line.length <= MAX_LINE_BYTES) consume(line)
        else limited = true
        skipLine = false
        if (++lines % 100 === 0) await yieldTask()
        if (entries.length > 100_000) throw new Error('Session exceeds search limit')
      }
      if (pending.length > MAX_LINE_BYTES) { pending = ''; skipLine = true; limited = true }
    }
    if (pending && !skipLine) consume(pending)
    if (!headerSeen) throw new Error('Missing session header')
    const after = await lstat(target.sessionFile)
    if (after.isSymbolicLink() || Number(after.dev) !== target.identity.dev || Number(after.ino) !== target.identity.ino || after.size < stat.size) throw new Error('Session changed')
    return { entries, limited }
  } finally { await file.close().catch(() => undefined) }
}

export class ConversationSearchService {
  private readonly scans = new Map<string, Scan>()
  constructor(private readonly catalog: Pick<OfficialPiSessionCatalog, 'listSearchTargets' | 'revalidateControlTarget'>) {}

  async search(raw: ConversationSearchInput): Promise<ConversationSearchResult> {
    const input = conversationSearchInputSchema.parse(raw)
    const scopes = [...new Map(input.scopes.map((scope) => [conversationScopeKey(scope), scope])).values()]
    const fingerprint = JSON.stringify([input.query, scopes.map(conversationScopeKey).sort()])
    for (const [id, scan] of this.scans) if (scan.expires < Date.now()) this.scans.delete(id)
    let id = input.cursor
    let scan = id ? this.scans.get(id) : undefined
    if (id && (!scan || scan.fingerprint !== fingerprint)) throw new Error('Search expired; search again.')
    if (!scan) {
      const targets: Target[] = []
      let skipped = 0
      for (const scope of scopes) {
        try {
          const result = await this.catalog.listSearchTargets(scope)
          targets.push(...result.targets)
          skipped += result.unavailable
        } catch { skipped++ }
        await yieldTask()
      }
      id = randomUUID()
      scan = { fingerprint, expires: Date.now() + 300_000, targets, offset: 0, skipped, limited: false }
      this.scans.set(id, scan)
      while (this.scans.size > 16) this.scans.delete(this.scans.keys().next().value!)
    }
    if (scan.result) return structuredClone(scan.result)
    if (scan.pending) return scan.pending
    const current = scan
    current.pending = (async () => {
      const hits: ConversationSearchHit[] = []
      const end = Math.min(current.offset + 3, current.targets.length)
      let skipped = current.skipped
      let limited = current.limited
      for (let offset = current.offset; offset < end; offset++) {
        const { summary, target } = current.targets[offset]
        try {
          await this.catalog.revalidateControlTarget(target)
          const parsed = await readSearchEntries(target)
          const result = searchActiveBranch(parsed.entries, input.query)
          limited ||= parsed.limited || result.limited
          hits.push(...result.hits.map((hit) => ({ ...hit, session: summary })))
        } catch { skipped++ }
        await yieldTask()
      }
      current.expires = Date.now() + 300_000
      const nextCursor = end < current.targets.length ? randomUUID() : null
      if (nextCursor) this.scans.set(nextCursor, { fingerprint, expires: current.expires, targets: current.targets, offset: end, skipped, limited })
      while (this.scans.size > 16) this.scans.delete(this.scans.keys().next().value!)
      current.result = { hits, nextCursor, scanned: end, total: current.targets.length, skipped, limited }
      return structuredClone(current.result)
    })()
    try { return await current.pending } finally { current.pending = undefined }
  }
}
