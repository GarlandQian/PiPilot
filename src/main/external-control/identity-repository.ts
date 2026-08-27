import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  EXTERNAL_CONTROL_PROTOCOL_VERSION,
  externalControlConversationIdSchema,
} from '../../shared/external-control'

const identitySchema = z.object({
  version: z.literal(1),
  key: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/u),
}).strict()

export class ExternalControlIdentityRepository {
  private key: string | null = null

  constructor(
    private readonly filePath: string,
    private readonly createKey: () => string = () => randomBytes(32).toString('base64url'),
  ) {}

  initialize() {
    if (this.key) return
    try {
      const document = identitySchema.parse(JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown)
      this.key = document.key
      chmodSync(this.filePath, 0o600)
      return
    } catch {
      // Unreleased 0.0.1 may replace malformed local identity state.
    }
    const document = identitySchema.parse({ version: 1, key: this.createKey() })
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 })
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(document)}\n`, { mode: 0o600 })
      renameSync(temporaryPath, this.filePath)
      chmodSync(this.filePath, 0o600)
    } catch (error) {
      try { unlinkSync(temporaryPath) } catch { /* no temporary file */ }
      throw error
    }
    this.key = document.key
  }

  conversationId(scopeKey: string, canonicalSessionFile: string) {
    this.initialize()
    const digest = createHmac('sha256', Buffer.from(this.key!, 'base64url'))
      .update(JSON.stringify([
        EXTERNAL_CONTROL_PROTOCOL_VERSION,
        scopeKey,
        canonicalSessionFile,
      ]))
      .digest('base64url')
    return externalControlConversationIdSchema.parse(`conv_${digest}`)
  }
}
