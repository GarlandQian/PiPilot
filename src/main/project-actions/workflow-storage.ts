import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { z } from 'zod'

/** Fail closed on corrupt data; never silently replace the user's saved actions. */
export async function readWorkflowFile<T>(path: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  try { return schema.parse(JSON.parse(await readFile(path, 'utf8'))) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error }
}
export async function writeWorkflowFile(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
}
export class ProjectWorkflowError extends Error {
  readonly code = 'PROJECT_WORKFLOW_FAILED'
}
