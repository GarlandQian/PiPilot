import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import { MAX_SCHEDULED_RUNS, MAX_SCHEDULED_TASKS, scheduledRunSchema, scheduledTaskSchema, type ScheduledRun, type ScheduledTask } from '../../shared/scheduled-tasks'

const documentSchema = z.object({ version: z.literal(1), tasks: z.array(scheduledTaskSchema).max(MAX_SCHEDULED_TASKS), runs: z.array(scheduledRunSchema).max(MAX_SCHEDULED_RUNS) }).strict()
export interface ScheduledTaskDocument { tasks: ScheduledTask[]; runs: ScheduledRun[] }

/** Write-ahead dispatch reservations must reach disk before a prompt is sent. */
export class ScheduledTaskRepository {
  constructor(private readonly filePath: string) {}
  load(): ScheduledTaskDocument {
    try {
      const value = documentSchema.parse(JSON.parse(readFileSync(this.filePath, 'utf8')))
      if (new Set(value.tasks.map((task) => task.id)).size !== value.tasks.length || new Set(value.runs.map((run) => run.id)).size !== value.runs.length) throw new Error('Duplicate schedule identities.')
      return { tasks: value.tasks, runs: value.runs }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { tasks: [], runs: [] }
      // Never replace malformed ledgers with empty state: that could replay work.
      throw error
    }
  }
  save(value: ScheduledTaskDocument) {
    const document = documentSchema.parse({ version: 1, ...value })
    const directory = dirname(this.filePath)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    try {
      const file = openSync(temporary, 'wx', 0o600)
      try { writeFileSync(file, `${JSON.stringify(document)}\n`); fsyncSync(file) } finally { closeSync(file) }
      renameSync(temporary, this.filePath)
      if (process.platform !== 'win32') {
        const folder = openSync(directory, 'r')
        try { fsyncSync(folder) } finally { closeSync(folder) }
      }
    } finally { try { unlinkSync(temporary) } catch { /* renamed or never created */ } }
  }
}
