import type { LocalPiImageContent } from '@/shared/local-pi'

export type DurableOutboxAction = 'prompt' | 'follow_up' | 'steer'
export type DurableOutboxStatus = 'pending' | 'sending' | 'failed' | 'unknown'

export interface DurableOutboxInput {
  id: string
  /** Serialized composer text, including file and skill references. */
  text: string
  images?: readonly LocalPiImageContent[]
  action: DurableOutboxAction
}

export interface DurableOutboxItem extends Readonly<Omit<DurableOutboxInput, 'images'>> {
  readonly images: readonly LocalPiImageContent[]
  readonly status: DurableOutboxStatus
  readonly createdAt: number
  readonly updatedAt: number
  readonly error?: string
}

export interface DurableOutboxPersistence {
  read(key: string): Promise<readonly DurableOutboxItem[]>
  /** Resolves only when the complete transaction has committed. */
  write(key: string, items: readonly DurableOutboxItem[]): Promise<void>
}

const EMPTY: readonly DurableOutboxItem[] = Object.freeze([])
const DATABASE_NAME = 'pipilot-composer-outbox'
const STORE_NAME = 'conversations'

function capture(item: DurableOutboxItem): DurableOutboxItem {
  return Object.freeze({
    ...item,
    images: Object.freeze(item.images.map((image) => Object.freeze({ ...image }))),
  })
}

function validateStoredItems(value: unknown): readonly DurableOutboxItem[] {
  if (!Array.isArray(value)) throw new Error('The saved message outbox is invalid.')
  const ids = new Set<string>()
  for (const item of value) {
    if (
      !item || typeof item !== 'object' ||
      typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
      typeof item.text !== 'string' ||
      !['prompt', 'follow_up', 'steer'].includes(item.action) ||
      !['pending', 'sending', 'failed', 'unknown'].includes(item.status) ||
      !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt) ||
      (item.error !== undefined && typeof item.error !== 'string') ||
      !Array.isArray(item.images) || item.images.some((image: unknown) => {
        if (!image || typeof image !== 'object') return true
        const content = image as Record<string, unknown>
        return content.type !== 'image' || typeof content.data !== 'string' ||
          typeof content.mimeType !== 'string' || !content.mimeType
      })
    ) throw new Error('The saved message outbox is invalid.')
    ids.add(item.id)
  }
  return value as DurableOutboxItem[]
}

/** Never falls back to localStorage: a failed durable write must leave the draft intact. */
export class IndexedDbOutboxPersistence implements DurableOutboxPersistence {
  private database: Promise<IDBDatabase> | undefined

  constructor(private readonly getFactory = (): IDBFactory | undefined => globalThis.indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    const factory = this.getFactory()
    if (!factory) return Promise.reject(new Error('Durable message storage is unavailable.'))
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DATABASE_NAME, 1)
      let rejected = false
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
      request.onerror = () => reject(request.error ?? new Error('Could not open durable message storage.'))
      request.onblocked = () => {
        rejected = true
        reject(new Error('Durable message storage is blocked by another application window.'))
      }
      request.onsuccess = () => {
        const database = request.result
        if (rejected) { database.close(); return }
        database.onversionchange = () => {
          database.close()
          this.database = undefined
        }
        database.onclose = () => { this.database = undefined }
        resolve(database)
      }
    })
    this.database = opening
    void opening.catch(() => { if (this.database === opening) this.database = undefined })
    return opening
  }

  async read(key: string): Promise<readonly DurableOutboxItem[]> {
    const database = await this.open()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(key)
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not load saved messages.'))
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not load saved messages.'))
      transaction.oncomplete = () => {
        try { resolve(request.result === undefined ? EMPTY : validateStoredItems(request.result.items)) }
        catch (error) { reject(error) }
      }
    })
  }

  async write(key: string, items: readonly DurableOutboxItem[]): Promise<void> {
    const database = await this.open()
    return new Promise((resolve, reject) => {
      // Strict durability waits for the backing store, not merely request success.
      const transaction = database.transaction(STORE_NAME, 'readwrite', { durability: 'strict' })
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not save this message.'))
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save this message.'))
      if (items.length) transaction.objectStore(STORE_NAME).put({ key, items })
      else transaction.objectStore(STORE_NAME).delete(key)
    })
  }
}

/**
 * Conversation-owned delivery records. The caller dispatches only after add/replace
 * resolves, and removes a record only after authoritative acceptance. No auto-send.
 */
export class DurableComposerOutbox {
  private readonly items = new Map<string, readonly DurableOutboxItem[]>()
  private readonly loaded = new Set<string>()
  private readonly tails = new Map<string, Promise<unknown>>()
  private readonly listeners = new Map<string, Set<() => void>>()

  constructor(
    private readonly persistence: DurableOutboxPersistence = new IndexedDbOutboxPersistence(),
    private readonly now = () => Date.now(),
  ) {}

  snapshot(key: string): readonly DurableOutboxItem[] { return this.items.get(key) ?? EMPTY }

  subscribe(key: string, listener: () => void): () => void {
    const listeners = this.listeners.get(key) ?? new Set<() => void>()
    this.listeners.set(key, listeners)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.listeners.delete(key)
    }
  }

  private serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(operation, operation)
    this.tails.set(key, result)
    const clean = () => { if (this.tails.get(key) === result) this.tails.delete(key) }
    void result.then(clean, clean)
    return result
  }

  private publish(key: string, items: readonly DurableOutboxItem[]) {
    const snapshot = items.length ? Object.freeze([...items]) : EMPTY
    if (this.snapshot(key) === snapshot) return
    this.items.set(key, snapshot)
    for (const listener of this.listeners.get(key) ?? []) listener()
  }

  private async hydrate(key: string): Promise<readonly DurableOutboxItem[]> {
    if (this.loaded.has(key)) return this.snapshot(key)
    const stored = await this.persistence.read(key)
    let recovered = false
    const items = stored.map((item) => {
      if (item.status !== 'pending' && item.status !== 'sending') return capture(item)
      recovered = true
      return capture({ ...item, status: 'unknown', updatedAt: this.now() })
    })
    // A crash may happen before or after Pi acceptance. Never infer safe retry.
    if (recovered) await this.persistence.write(key, items)
    this.loaded.add(key)
    this.publish(key, items)
    return this.snapshot(key)
  }

  load(key: string): Promise<readonly DurableOutboxItem[]> {
    return this.serialize(key, () => this.hydrate(key))
  }

  private newItem(input: DurableOutboxInput): DurableOutboxItem {
    if (!input.id) throw new Error('A saved message must have an identity.')
    if (!input.text.trim() && !input.images?.length) throw new Error('A saved message cannot be empty.')
    const time = this.now()
    return capture({ ...input, images: input.images ?? [], status: 'pending', createdAt: time, updatedAt: time })
  }

  add(key: string, input: DurableOutboxInput): Promise<DurableOutboxItem> {
    // Capture before awaiting storage so edits to caller-owned images cannot leak in.
    const item = this.newItem(input)
    return this.serialize(key, async () => {
      const previous = await this.hydrate(key)
      if (previous.some((entry) => entry.id === item.id)) throw new Error('This message identity already exists.')
      const next = [...previous, item]
      await this.persistence.write(key, next)
      this.publish(key, next)
      return item
    })
  }

  update(
    key: string,
    id: string,
    patch: { status?: DurableOutboxStatus; error?: string },
  ): Promise<DurableOutboxItem> {
    const capturedPatch = { ...patch }
    return this.serialize(key, async () => {
      const previous = await this.hydrate(key)
      const item = previous.find((entry) => entry.id === id)
      if (!item) throw new Error('The saved message no longer exists.')
      const updated = capture({ ...item, ...capturedPatch, status: capturedPatch.status ?? item.status, updatedAt: this.now() })
      const next = previous.map((entry) => entry.id === id ? updated : entry)
      await this.persistence.write(key, next)
      this.publish(key, next)
      return updated
    })
  }

  /** An edited retry has a fresh identity; replacing it is one durable transaction. */
  replace(key: string, oldId: string, input: DurableOutboxInput): Promise<DurableOutboxItem> {
    const item = this.newItem(input)
    return this.serialize(key, async () => {
      const previous = await this.hydrate(key)
      const old = previous.find((entry) => entry.id === oldId)
      if (!old || old.status !== 'failed') throw new Error('Only a failed message can be replaced.')
      if (previous.some((entry) => entry.id === item.id)) throw new Error('An edited message needs a new identity.')
      const next = previous.map((entry) => entry.id === oldId ? item : entry)
      await this.persistence.write(key, next)
      this.publish(key, next)
      return item
    })
  }

  remove(key: string, id: string): Promise<void> {
    return this.serialize(key, async () => {
      const previous = await this.hydrate(key)
      const next = previous.filter((entry) => entry.id !== id)
      if (previous.length === next.length) return
      await this.persistence.write(key, next)
      this.publish(key, next)
    })
  }

  /** Release subscriptions without deleting saved messages or cancelling writes. */
  dispose() { this.listeners.clear() }
}

export const durableComposerOutbox = new DurableComposerOutbox()
