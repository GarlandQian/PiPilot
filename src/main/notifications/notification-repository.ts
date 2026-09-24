import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { z } from 'zod'
import { taskNotificationSchema, type TaskNotification } from '../../shared/task-notifications'

export interface StoredTaskNotification {
  item: TaskNotification
  sessionFile: string | null
}

const documentSchema = z.object({
  version: z.literal(1),
  records: z.array(z.object({
    item: taskNotificationSchema,
    sessionFile: z.string().max(4_096).refine((path) => isAbsolute(path) && !path.includes('\0')).nullable(),
  }).strict()).max(100),
}).strict()
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000

export function retainedNotifications(records: readonly StoredTaskNotification[], now: number) {
  return records.filter(({ item }) => item.createdAt >= now - MAX_AGE_MS && item.createdAt <= now)
    .slice(-100)
}

/** Private Main-only physical targets are never projected into Renderer DTOs. */
export class NotificationRepository {
  private tail = Promise.resolve()

  constructor(private readonly filePath: string, private readonly reportFailure: () => void = () => undefined) {}

  async load(now: number): Promise<StoredTaskNotification[]> {
    try {
      if ((await stat(this.filePath)).size > 1024 * 1024) return []
      const document = documentSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')))
      const seen = new Set<string>()
      return retainedNotifications(document.records, now).filter(({ item }) => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return true
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.reportFailure()
      return []
    }
  }

  save(records: readonly StoredTaskNotification[]) {
    const text = JSON.stringify({ version: 1, records })
    this.tail = this.tail.then(async () => {
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
      try {
        await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
        await writeFile(temporaryPath, text, { mode: 0o600, flag: 'wx' })
        await rename(temporaryPath, this.filePath)
      } catch {
        await unlink(temporaryPath).catch(() => undefined)
        this.reportFailure()
      }
    }).catch(() => undefined)
  }

  flush() { return this.tail }
}
