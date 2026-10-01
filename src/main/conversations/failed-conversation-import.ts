import { lstat, open, unlink } from 'node:fs/promises'

/** Roll back only a freshly imported, exact SDK Session identity. This never
 * accepts a renderer path and never removes a directory or an older session. */
export async function removeFailedConversationImport(sessionFile: string | null, sessionId: string, importId: string | undefined) {
  if (!sessionFile || !importId) return false
  let before
  try { before = await lstat(sessionFile) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  if (!before.isFile() || before.isSymbolicLink() || before.size > 64 * 1024 * 1024) return false
  const handle = await open(sessionFile, 'r')
  let matched = false
  try {
    const opened = await handle.stat()
    if (opened.dev !== before.dev || opened.ino !== before.ino) return false
    const buffer = Buffer.alloc(opened.size)
    let bytesRead = 0
    while (bytesRead < buffer.length) {
      const read = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead)
      if (!read.bytesRead) break
      bytesRead += read.bytesRead
    }
    if (bytesRead !== opened.size) return false
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n')
    const header: unknown = JSON.parse(lines.shift() ?? '')
    if (!header || typeof header !== 'object' || !('id' in header) || !('type' in header) || header.type !== 'session' || header.id !== sessionId) return false
    for (const line of lines) {
      if (!line) continue
      let entry: unknown
      try { entry = JSON.parse(line) as unknown } catch { return false }
      if (!entry || typeof entry !== 'object') continue
      const value = entry as { type?: string; customType?: string; data?: { importId?: string } }
      // A completed import is a durable new conversation. Preserve it even if
      // activation failed; the same import ID will reopen it on retry. It may
      // already contain later user work, so compensation must never delete it.
      if (value.type === 'custom' && value.customType === 'pipilot.import-complete' && value.data?.importId === importId) return false
      if (value.type === 'custom' && value.customType === 'pipilot.import-origin' && value.data?.importId === importId) matched = true
    }
  } finally { await handle.close() }
  if (!matched) return false
  const current = await lstat(sessionFile)
  if (!current.isFile() || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size || current.mtimeMs !== before.mtimeMs) return false
  await unlink(sessionFile)
  return true
}
