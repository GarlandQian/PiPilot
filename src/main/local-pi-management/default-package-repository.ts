import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { piDefaultPackageSchema, type PiDefaultPackage } from '../../shared/pi-integrations'

const recordSchema = z.object({
  version: z.literal(1),
  package: piDefaultPackageSchema,
}).strict()

/** A durable, per-agent-directory decision, independent of app/SDK versions. */
export class DefaultPackageRepository {
  private readonly directory: string

  constructor(agentDir: string) {
    this.directory = join(agentDir, 'pipilot', 'default-packages-v1')
  }

  private path(packageName: string) {
    return join(this.directory, `${createHash('sha256').update(packageName).digest('hex')}.json`)
  }

  async read(packageName: string): Promise<PiDefaultPackage | null> {
    try {
      const path = this.path(packageName)
      const info = await stat(path)
      if (!info.isFile() || info.size > 16_384) throw new Error('Invalid default-package record.')
      const record = recordSchema.parse(JSON.parse(await readFile(path, 'utf8')))
      if (record.package.packageName !== packageName) throw new Error('Invalid default-package identity.')
      return record.package
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      // An unreadable decision must never be treated as permission to reinstall.
      throw new Error(`The saved installation decision for ${packageName} could not be read.`)
    }
  }

  async claim(value: PiDefaultPackage): Promise<boolean> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    let file
    try {
      file = await open(this.path(value.packageName), 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw error
    }
    try {
      await file.writeFile(this.serialize(value), 'utf8')
      // Persist the claim before permitting any package-manager side effect.
      await file.sync()
    } finally {
      await file.close()
    }
    return true
  }

  async save(value: PiDefaultPackage) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const path = this.path(value.packageName)
    const temporaryPath = `${path}.${randomUUID()}.tmp`
    const file = await open(temporaryPath, 'wx', 0o600)
    try {
      await file.writeFile(this.serialize(value), 'utf8')
      await file.sync()
      await file.close()
      await rename(temporaryPath, path)
    } catch (error) {
      await file.close().catch(() => undefined)
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  private serialize(value: PiDefaultPackage) {
    return `${JSON.stringify(recordSchema.parse({ version: 1, package: value }))}\n`
  }
}
