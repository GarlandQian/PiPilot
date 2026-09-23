import * as React from 'react'
import { useT } from '@/i18n'
import type { LocalPiImageContent } from '@/shared/local-pi'
import { PiSubmissionError, type PiSubmissionStatus } from '@/renderer/pi-rpc/delivery-state'
import { durableComposerOutbox as storage, type DurableOutboxItem } from './durable-outbox'

// Visit changes must not dispose a submission whose Pi acceptance is in flight.
const activeDeliveries = new Set<string>()
// A failed status write must not leave an inactive message looking "sending"
// forever. This is presentation-only; recovery still queries Pi before retry.
const recoveryRequired = new Set<string>()
const recoveryListeners = new Set<() => void>()
let recoveryRevision = 0
function markRecovery(identity: string, required: boolean) {
  if (recoveryRequired.has(identity) === required) return
  if (required) recoveryRequired.add(identity)
  else recoveryRequired.delete(identity)
  recoveryRevision += 1
  for (const listener of recoveryListeners) listener()
}
function subscribeRecovery(listener: () => void) {
  recoveryListeners.add(listener)
  return () => { recoveryListeners.delete(listener) }
}
const getRecoveryRevision = () => recoveryRevision

export function useComposerOutbox({ draftKey, scopeKey, onSubmit, onCheckSubmission }: {
  draftKey: string
  scopeKey: string
  onSubmit(text: string, action: DurableOutboxItem['action'], images: readonly LocalPiImageContent[], id: string): Promise<void>
  onCheckSubmission(id: string): Promise<PiSubmissionStatus>
}) {
  const t = useT()
  const owner = React.useRef<string | null>(scopeKey)
  owner.current = scopeKey
  const [storageError, setStorageError] = React.useState<string | null>(null)
  const subscribe = React.useCallback((listener: () => void) => storage.subscribe(draftKey, listener), [draftKey])
  const snapshot = React.useCallback(() => storage.snapshot(draftKey), [draftKey])
  const items = React.useSyncExternalStore(subscribe, snapshot, snapshot)
  React.useSyncExternalStore(subscribeRecovery, getRecoveryRevision, getRecoveryRevision)

  React.useEffect(() => {
    owner.current = scopeKey
    void storage.load(draftKey).then(() => {
      if (owner.current === scopeKey) setStorageError(null)
    }, () => {
      if (owner.current === scopeKey) setStorageError(t('composer.outboxStorageFailed'))
    })
    return () => { owner.current = null }
  }, [draftKey, scopeKey, t])

  const send = React.useCallback(async (item: DurableOutboxItem) => {
    const identity = `${draftKey}:${item.id}`
    if (activeDeliveries.has(identity)) return
    activeDeliveries.add(identity)
    let submitted = false
    try {
      await storage.update(draftKey, item.id, { status: 'sending', error: undefined })
      if (owner.current !== scopeKey) {
        await storage.update(draftKey, item.id, { status: 'failed', error: t('composer.outboxConversationChanged') })
        return
      }
      submitted = true
      await onSubmit(item.text, item.action, item.images, item.id)
      await storage.remove(draftKey, item.id)
      markRecovery(identity, false)
    } catch (error) {
      // Transport failure is not proof of rejection; never offer blind retry.
      const rejected = !submitted || (error instanceof PiSubmissionError && error.status === 'rejected')
      try {
        await storage.update(draftKey, item.id, {
          status: rejected ? 'failed' : 'unknown',
          error: error instanceof Error ? error.message : t('composer.sendFailed'),
        })
      } catch {
        markRecovery(identity, true)
        if (owner.current === scopeKey) setStorageError(t('composer.outboxStorageFailed'))
      }
    } finally {
      activeDeliveries.delete(identity)
    }
  }, [draftKey, onSubmit, scopeKey, t])

  const check = React.useCallback(async (item: DurableOutboxItem) => {
    const result = await onCheckSubmission(item.id)
    if (result === 'accepted') {
      await storage.remove(draftKey, item.id)
    } else {
      await storage.update(draftKey, item.id, {
        status: result === 'rejected' || result === 'missing' ? 'failed' : 'unknown',
        error: t(result === 'missing' ? 'composer.outboxNotReceived' : result === 'rejected' ? 'composer.sendFailed' : 'composer.outboxUnconfirmedHint'),
      })
    }
    markRecovery(`${draftKey}:${item.id}`, false)
    if (owner.current === scopeKey) setStorageError(null)
  }, [draftKey, onCheckSubmission, scopeKey, t])

  const retry = React.useCallback(async (item: DurableOutboxItem, text = item.text, images = item.images) => {
    const replacement = await storage.replace(draftKey, item.id, {
      id: crypto.randomUUID(), text, images, action: item.action,
    })
    markRecovery(`${draftKey}:${item.id}`, false)
    void send(replacement)
  }, [draftKey, send])

  return {
    items: items.map((item): DurableOutboxItem => recoveryRequired.has(`${draftKey}:${item.id}`)
      ? { ...item, status: 'unknown' } : item),
    storageError, send, check, retry,
    save: React.useCallback(async (text: string, action: DurableOutboxItem['action'], images: readonly LocalPiImageContent[]) => {
      const item = await storage.add(draftKey, { id: crypto.randomUUID(), text, action, images })
      if (owner.current === scopeKey) setStorageError(null)
      return item
    }, [draftKey, scopeKey]),
    remove: React.useCallback(async (item: DurableOutboxItem) => {
      await storage.remove(draftKey, item.id)
      markRecovery(`${draftKey}:${item.id}`, false)
    }, [draftKey]),
  }
}
