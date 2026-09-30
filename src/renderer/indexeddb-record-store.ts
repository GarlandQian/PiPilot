/** Local, strict-durability records shared by Composer drafts and the send outbox. */
export class IndexedDbRecordStore {
  private database: Promise<IDBDatabase> | undefined

  constructor(
    private readonly name: string,
    private readonly store: string,
    private readonly getFactory = (): IDBFactory | undefined => globalThis.indexedDB,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    const factory = this.getFactory()
    if (!factory) return Promise.reject(new Error('Durable message storage is unavailable.'))
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(this.name, 1)
      let rejected = false
      request.onupgradeneeded = () => request.result.createObjectStore(this.store, { keyPath: 'key' })
      request.onerror = () => reject(request.error ?? new Error('Could not open local message storage.'))
      request.onblocked = () => {
        rejected = true
        reject(new Error('Local message storage is blocked by another window.'))
      }
      request.onsuccess = () => {
        const database = request.result
        if (rejected) { database.close(); return }
        database.onversionchange = () => { database.close(); this.database = undefined }
        database.onclose = () => { this.database = undefined }
        resolve(database)
      }
    })
    this.database = opening
    void opening.catch(() => { if (this.database === opening) this.database = undefined })
    return opening
  }

  async read(key: string): Promise<unknown> {
    const database = await this.open()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.store, 'readonly')
      const request = transaction.objectStore(this.store).get(key)
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not load saved input.'))
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not load saved input.'))
      transaction.oncomplete = () => resolve(request.result)
    })
  }

  async write(key: string, fields?: Record<string, unknown>): Promise<void> {
    const database = await this.open()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.store, 'readwrite', { durability: 'strict' })
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not save this message.'))
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save this message.'))
      if (fields) transaction.objectStore(this.store).put({ ...fields, key })
      else transaction.objectStore(this.store).delete(key)
    })
  }
}
