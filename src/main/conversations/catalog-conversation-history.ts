import { createHash } from 'node:crypto'
import { lstat, open, realpath } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setImmediate as yieldTask } from 'node:timers/promises'
import { localPiSessionEntrySchema, type LocalPiSessionEntry } from '../../shared/local-pi'
import { ConversationExportError } from './conversation-markdown'
import { currentOfficialPiSessionHeaderSchema, type OfficialPiSessionControlTarget } from './official-pi-session-catalog'

const MAX_HISTORY_BYTES = 64 * 1024 * 1024
const MAX_HISTORY_ENTRIES = 100_000

/** Read an unopened official JSONL, without importing the SDK or running extensions. */
export async function readCatalogConversationHistory(target: OfficialPiSessionControlTarget) {
  const direct = await lstat(target.sessionFile)
  const canonical = await realpath(target.sessionFile)
  if (!direct.isFile() || direct.isSymbolicLink() || canonical !== target.sessionFile || dirname(canonical) !== target.root) {
    throw new ConversationExportError('EXPORT_STALE_SESSION', 'The conversation file changed. Open export again.')
  }
  const file = await open(target.sessionFile, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || Number(stat.dev) !== target.identity.dev || Number(stat.ino) !== target.identity.ino ||
        stat.size < target.identity.size || stat.size > MAX_HISTORY_BYTES) {
      throw new ConversationExportError('EXPORT_HISTORY_UNAVAILABLE', 'The conversation history could not be read safely.')
    }
    // Read exactly the captured length. Concurrent appends belong to a later
    // snapshot; an incomplete last JSONL record fails instead of dropping data.
    const bytes = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < bytes.length) {
      const result = await file.read(bytes, offset, Math.min(256 * 1024, bytes.length - offset), offset)
      if (!result.bytesRead) throw new ConversationExportError('EXPORT_STALE_SESSION', 'The conversation file changed. Open export again.')
      offset += result.bytesRead
    }
    const lines = bytes.toString('utf8').split('\n').filter((line) => line.trim().length > 0)
    const header = currentOfficialPiSessionHeaderSchema.parse(JSON.parse(lines.shift() ?? 'null'))
    if (header.id !== target.sessionId || lines.length > MAX_HISTORY_ENTRIES) {
      throw new ConversationExportError('EXPORT_HISTORY_UNAVAILABLE', 'The conversation history could not be read safely.')
    }
    const entries: LocalPiSessionEntry[] = []
    for (let index = 0; index < lines.length; index++) {
      entries.push(localPiSessionEntrySchema.parse(JSON.parse(lines[index])))
      if (index % 100 === 99) await yieldTask()
    }
    // Official SessionManager rebuilds its selected leaf from the last entry
    // when opening a persisted file. Live Sessions use get_entries instead.
    return {
      entries,
      leafId: entries[entries.length - 1]?.id ?? null,
      target: {
        ...target,
        contentDigest: createHash('sha256').update(bytes).digest('hex'),
        identity: { dev: Number(stat.dev), ino: Number(stat.ino), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs },
      } satisfies OfficialPiSessionControlTarget,
    }
  } catch (error) {
    if (error instanceof ConversationExportError) throw error
    throw new ConversationExportError('EXPORT_HISTORY_UNAVAILABLE', 'The conversation history is incomplete or invalid.')
  } finally {
    await file.close().catch(() => undefined)
  }
}
