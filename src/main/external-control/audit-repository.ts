import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ExternalControlOperation } from '../../shared/external-control'

const MAX_AUDIT_BYTES = 1024 * 1024

export class ConversationMcpAuditRepository {
  private tail = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly maxBytes = MAX_AUDIT_BYTES,
  ) {}

  append(operation: ExternalControlOperation) {
    const row = {
      operationId: operation.operationId,
      conversationId: operation.conversationId,
      kind: operation.kind,
      status: operation.status,
      requestedMode: operation.requestedMode,
      acceptedMode: operation.acceptedMode,
      receivedAt: operation.receivedAt,
      updatedAt: operation.updatedAt,
      errorCode: operation.error?.code,
    }
    this.tail = this.tail.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
      let currentSize = 0
      try {
        currentSize = (await stat(this.filePath)).size
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (currentSize >= this.maxBytes) {
        const backupPath = `${this.filePath}.1`
        try {
          await unlink(backupPath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        await rename(this.filePath, backupPath)
      }
      await writeFile(this.filePath, `${JSON.stringify(row)}\n`, {
        flag: 'a',
        mode: 0o600,
      })
    }).catch(() => undefined)
  }

  flush() {
    return this.tail
  }
}
