import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'

const preferenceSchema = z.object({ version: z.literal(1), enabled: z.boolean() }).strict()

export class ExternalControlPreferenceRepository {
  private initialized = false
  private enabled = false

  constructor(private readonly filePath: string) {}

  get() {
    if (!this.initialized) this.initialize()
    return this.enabled
  }

  set(enabled: boolean) {
    if (!this.initialized) this.initialize()
    if (this.enabled === enabled) return this.enabled
    this.persist(enabled)
    this.enabled = enabled
    return this.enabled
  }

  private initialize() {
    try {
      const document = preferenceSchema.parse(
        JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown,
      )
      this.enabled = document.enabled
    } catch {
      this.enabled = false
      this.persist(this.enabled)
    }
    this.initialized = true
  }

  private persist(enabled: boolean) {
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 })
    try {
      writeFileSync(
        temporaryPath,
        `${JSON.stringify(preferenceSchema.parse({ version: 1, enabled }))}\n`,
        { encoding: 'utf8', mode: 0o600 },
      )
      renameSync(temporaryPath, this.filePath)
    } catch (error) {
      try { unlinkSync(temporaryPath) } catch { /* no temporary file */ }
      throw error
    }
  }
}
