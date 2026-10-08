import { randomUUID } from 'node:crypto'
import { accessSync, constants, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

/** A startup preference only: changing it must never redirect a live session. */
export class PiDirectoryPreference {
  private selected: string | null
  readonly activeDirectory: string

  constructor(private readonly file: string, readonly defaultDirectory: string) {
    try {
      const value = JSON.parse(readFileSync(file, 'utf8')) as { directory?: unknown }
      if (value.directory !== null && (typeof value.directory !== 'string' || !isAbsolute(value.directory) || /[\0\r\n]/u.test(value.directory))) {
        throw new Error('Invalid Pi directory preference.')
      }
      this.selected = value.directory as string | null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.selected = null
    }
    this.activeDirectory = this.selected ?? defaultDirectory
  }

  snapshot() {
    return {
      activeDirectory: this.activeDirectory,
      defaultDirectory: this.defaultDirectory,
      selectedDirectory: this.selected,
      restartRequired: (this.selected ?? this.defaultDirectory) !== this.activeDirectory,
    }
  }

  select(directory: string | null) {
    if (directory !== null) {
      if (!isAbsolute(directory) || /[\0\r\n]/u.test(directory)) throw new Error('Choose an absolute Pi configuration directory.')
      directory = resolve(directory)
      if (!statSync(directory).isDirectory()) throw new Error('Choose a directory.')
      accessSync(directory, constants.R_OK | constants.W_OK | constants.X_OK)
    }
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify({ directory }) + '\n', { mode: 0o600, flag: 'wx' })
      renameSync(temporary, this.file)
    } finally {
      try { unlinkSync(temporary) } catch { /* Already renamed, or never created. */ }
    }
    this.selected = directory
    return this.snapshot()
  }
}
