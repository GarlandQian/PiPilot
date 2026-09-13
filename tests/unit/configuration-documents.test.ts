import { describe, expect, it, vi } from 'vitest'
import { ConfigurationDocumentRegistry, isConfigDocumentDirty } from '../../src/renderer/configuration-documents'

interface Snapshot { content: string; fingerprint: string }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function operations(initial = '{"value":1}') {
  return {
    load: vi.fn(async (): Promise<Snapshot> => ({ content: initial, fingerprint: 'base' })),
    save: vi.fn(async (content: string, _fingerprint: string, _apply: boolean) => ({
      snapshot: { content, fingerprint: 'saved' },
      apply: 'saved' as const,
    })),
  }
}

describe('configuration document ownership', () => {
  it('retains one shared Form/JSON draft and fingerprint through A/B/A selection', async () => {
    const registry = new ConfigurationDocumentRegistry<Snapshot>(8, 1_024)
    const aOps = operations()
    const a = registry.get('A', aOps)!
    await a.load()
    a.updateDraft('// retained comment\n{"value":2,"future":true}')
    a.setView('json')
    const b = registry.get('B', operations('{"value":3}'))!
    await b.load()
    expect(b.getSnapshot().draftText).toBe('{"value":3}')
    expect(registry.get('A', aOps)).toBe(a)
    expect(a.getSnapshot()).toMatchObject({
      draftText: '// retained comment\n{"value":2,"future":true}',
      view: 'json', revision: 2, snapshot: { fingerprint: 'base' },
    })
    await a.load()
    expect(aOps.load).toHaveBeenCalledTimes(1)
    expect(isConfigDocumentDirty(a.getSnapshot())).toBe(true)
  })

  it('settles a background A save only into A and preserves newer A edits on return', async () => {
    const registry = new ConfigurationDocumentRegistry<Snapshot>(8, 1_024)
    const saveResult = deferred<{ snapshot: Snapshot; apply: 'saved' }>()
    const aOps = { ...operations(), save: vi.fn(() => saveResult.promise) }
    const a = registry.get('A', aOps)!
    await a.load()
    a.updateDraft('captured A')
    const saving = a.save(true)
    const b = registry.get('B', operations('B'))!
    await b.load()
    expect(registry.get('A', aOps)!.getSnapshot().phase).toBe('saving')
    a.updateDraft('newer A')
    saveResult.resolve({ snapshot: { content: 'captured A', fingerprint: 'saved A' }, apply: 'saved' })
    await saving
    expect(aOps.save).toHaveBeenCalledWith('captured A', 'base', true)
    expect(a.getSnapshot()).toMatchObject({ draftText: 'newer A', phase: 'idle', snapshot: { fingerprint: 'saved A' } })
    expect(b.getSnapshot()).toMatchObject({ draftText: 'B', snapshot: { fingerprint: 'base' } })
  })

  it('rejects duplicate saves while an exact document save is pending', async () => {
    const saved = deferred<{ snapshot: Snapshot; apply: 'saved' }>()
    const ops = { ...operations(), save: vi.fn(() => saved.promise) }
    const document = new ConfigurationDocumentRegistry<Snapshot>(1, 1_024).get('A', ops)!
    await document.load()
    const first = document.save(true)
    expect(await document.save(true)).toBeNull()
    expect(ops.save).toHaveBeenCalledTimes(1)
    saved.resolve({ snapshot: { content: '{}', fingerprint: 'new' }, apply: 'saved' })
    await first
  })

  it('preserves text and baseline after a conflict or save failure', async () => {
    const ops = { ...operations(), save: vi.fn(async () => { throw Object.assign(new Error('Conflict'), { code: 'MCP_CONFIG_CONFLICT' }) }) }
    const document = new ConfigurationDocumentRegistry<Snapshot>(1, 1_024).get('A', ops)!
    await document.load()
    document.updateDraft('unsaved')
    await document.save(false)
    expect(document.getSnapshot()).toMatchObject({
      draftText: 'unsaved', snapshot: { fingerprint: 'base' }, phase: 'idle', error: { code: 'MCP_CONFIG_CONFLICT' },
    })
  })

  it('preserves edits made while a confirmed reload is in flight', async () => {
    const next = deferred<Snapshot>()
    const ops = operations()
    const document = new ConfigurationDocumentRegistry<Snapshot>(1, 1_024).get('A', ops)!
    await document.load()
    document.updateDraft('discarded text')
    ops.load.mockImplementationOnce(() => next.promise)
    const loading = document.load(true)
    document.updateDraft('typed during reload')
    next.resolve({ content: 'disk version', fingerprint: 'disk' })
    await loading
    expect(document.getSnapshot()).toMatchObject({ draftText: 'typed during reload', snapshot: { content: 'disk version', fingerprint: 'disk' } })
  })

  it('does not discard pre-load text when an automatic load retries', async () => {
    const document = new ConfigurationDocumentRegistry<Snapshot>(1, 1_024).get('A', operations())!
    document.updateDraft('typed before load')
    await document.load()
    expect(document.getSnapshot().draftText).toBe('typed before load')
    expect(document.getSnapshot().snapshot?.fingerprint).toBe('base')
    await document.load(true)
    expect(document.getSnapshot().draftText).toBe('{"value":1}')
  })

  it('never evicts dirty, subscribed, or in-flight documents at the capacity bound', async () => {
    const registry = new ConfigurationDocumentRegistry<Snapshot>(2, 1_024)
    const a = registry.get('A', operations())!
    await a.load()
    a.updateDraft('dirty A')
    const b = registry.get('B', operations())!
    await b.load()
    const unsubscribe = b.subscribe(() => undefined)
    expect(registry.get('C', operations())).toBeNull()
    unsubscribe()
    expect(registry.get('C', operations())).not.toBeNull()
    expect(registry.get('A', operations())).toBe(a)

    const pending = deferred<Snapshot>()
    const single = new ConfigurationDocumentRegistry<Snapshot>(1, 1_024)
    const loading = single.get('A', { ...operations(), load: () => pending.promise })!.load()
    expect(single.get('B', operations())).toBeNull()
    pending.resolve({ content: '{}', fingerprint: 'ready' })
    await loading
    expect(single.get('B', operations())).not.toBeNull()
  })

  it('enforces the UTF-8 content bound without replacing the last accepted draft', async () => {
    const document = new ConfigurationDocumentRegistry<Snapshot>(1, 6).get('A', operations('{}'))!
    await document.load()
    expect(document.updateDraft('中文')).toBe(true)
    expect(document.updateDraft('中文多')).toBe(false)
    expect(document.getSnapshot()).toMatchObject({ draftText: '中文', error: { code: 'CONFIG_DOCUMENT_TOO_LARGE' } })
  })

  it('keeps an oversized load out of the retained state', async () => {
    const document = new ConfigurationDocumentRegistry<Snapshot>(1, 3).get('A', operations('too large'))!
    expect(await document.load()).toBe(false)
    expect(document.getSnapshot()).toMatchObject({ snapshot: null, draftText: '', phase: 'idle', error: { code: 'CONFIG_DOCUMENT_TOO_LARGE' } })
  })
})
