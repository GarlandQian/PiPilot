import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { compactModelsDev, type ModelsDevIndex } from '../../shared/model-catalog'

export const MODELS_DEV_URL = 'https://models.dev/api.json'
const FRESH_MS = 24 * 60 * 60 * 1_000
const FETCH_TIMEOUT_MS = 10_000
const RESPONSE_LIMIT = 32 * 1_024 * 1_024

interface CachedIndex {
  fetchedAt: number
  index: ModelsDevIndex
}

/**
 * models.dev's public model database, read at most once a day and kept on
 * disk, so filling in models works offline with the last copy. Nothing about
 * the user is sent: it is one GET of a public file.
 */
export class ModelsDevService {
  private memory: CachedIndex | null = null
  private loading: Promise<ModelsDevIndex | null> | null = null

  constructor(private readonly options: {
    cachePath: string
    enabled(): boolean
    fetchImpl?: typeof fetch
    now?: () => number
  }) {}

  /** The current index, or null when switched off or never fetched. */
  index(): Promise<ModelsDevIndex | null> {
    if (!this.options.enabled()) return Promise.resolve(null)
    const now = this.options.now?.() ?? Date.now()
    if (this.memory && now - this.memory.fetchedAt < FRESH_MS) return Promise.resolve(this.memory.index)
    this.loading ??= this.refresh(now).finally(() => { this.loading = null })
    return this.loading
  }

  private async refresh(now: number): Promise<ModelsDevIndex | null> {
    const cached = this.memory ?? await this.readDisk()
    if (cached && now - cached.fetchedAt < FRESH_MS) {
      this.memory = cached
      return cached.index
    }
    try {
      const index = await this.download()
      this.memory = { fetchedAt: now, index }
      await this.writeDisk(this.memory).catch(() => undefined)
      return index
    } catch {
      // Offline or unreachable: a stale copy still knows most models.
      if (cached) this.memory = cached
      return cached?.index ?? null
    }
  }

  private async download() {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await (this.options.fetchImpl ?? fetch)(MODELS_DEV_URL, { signal: controller.signal, headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const text = await response.text()
      if (text.length > RESPONSE_LIMIT) throw new Error('models.dev response is too large')
      const index = compactModelsDev(JSON.parse(text) as unknown)
      if (!index.providers.length) throw new Error('models.dev returned no providers')
      return index
    } finally {
      clearTimeout(timer)
    }
  }

  private async readDisk(): Promise<CachedIndex | null> {
    try {
      const value = JSON.parse(await readFile(this.options.cachePath, 'utf8')) as Partial<CachedIndex>
      return typeof value.fetchedAt === 'number' && value.index && Array.isArray(value.index.providers)
        ? { fetchedAt: value.fetchedAt, index: value.index }
        : null
    } catch {
      return null
    }
  }

  private async writeDisk(value: CachedIndex) {
    await mkdir(dirname(this.options.cachePath), { recursive: true })
    const temporary = `${this.options.cachePath}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.options.cachePath)
  }
}
