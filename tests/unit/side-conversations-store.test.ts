import { describe, expect, it } from 'vitest'
import { SideConversationsStore, type SideQuestionRequest } from '../../src/renderer/side-conversations-store'
import type { SideConversationSnapshot } from '../../src/shared/side-conversations'

const request = (id = 'request', parent = 'parent'): SideQuestionRequest => ({ id, scope: { kind: 'projectless' }, parentSessionId: parent, reference: {
  id: 'reference-' + id, ownerKey: 'projectless:' + parent, kind: 'message', sourceId: 'reply', label: 'Assistant response', text: 'Immutable source',
} })
const snapshot = (source = request()): SideConversationSnapshot => ({ sideId: 'side-' + source.id, scope: source.scope, parentSessionId: source.parentSessionId,
  reference: source.reference, sessionId: 'saved-' + source.id, sessionFile: '/fixture/session.jsonl', status: 'completed', released: false,
  model: null, models: [], thinkingLevel: 'off', thinkingLevels: ['off'], configuration: null, uiRequests: [], timeline: [], messages: [{ role: 'user', text: 'My question' }],
})

describe('side conversation views independent of panel lifetime', () => {
  it('retains each parent draft, selection and accepted history when views switch', () => {
    const store = new SideConversationsStore(), a = request(), b = request('b', 'another')
    store.add(a); store.update(a.id, { text: 'My question' }); store.accept(a.id, snapshot(), 'My question')
    store.update(a.id, { text: 'Unsent follow-up' }); store.add(b)
    store.add(a) // Remount repeats the request prop; it must not reset the view.
    expect(store.getSnapshot().threads).toHaveLength(2)
    expect(store.getSnapshot().threads[0]).toMatchObject({ text: 'Unsent follow-up', snapshot: { messages: [{ role: 'user', text: 'My question' }] } })
    expect(store.getSnapshot().selected).toEqual({ 'projectless:parent': a.id, 'projectless:another': b.id })
  })
  it('does not duplicate a pending creation when reopening lists it before acceptance returns', () => {
    const store = new SideConversationsStore(), source = request()
    store.add(source); store.update(source.id, { busy: true, text: 'My question' })
    store.merge(source.reference.ownerKey, [snapshot(source)])
    store.accept(source.id, snapshot(source), 'My question')
    expect(store.getSnapshot().threads).toHaveLength(1)
    expect(store.getSnapshot().threads[0]?.text).toBe('')
  })
  it('keeps text typed during acceptance and replaces draft model with authoritative settings', () => {
    const store = new SideConversationsStore(), source = request()
    store.add(source); store.update(source.id, { busy: true, text: 'Already writing next question', configuration: { provider: 'fixture', modelId: 'draft' } })
    store.accept(source.id, snapshot(source), 'My question')
    expect(store.getSnapshot().threads[0]).toMatchObject({ text: 'Already writing next question', busy: false })
    expect(store.getSnapshot().threads[0]?.configuration).toBeUndefined()
  })
  it('does not resurrect explicitly closed views; selects a newly discovered thread', () => {
    const store = new SideConversationsStore(), a = request(), b = request('b')
    store.add(a); store.accept(a.id, snapshot(a), ''); store.close(a.id)
    store.add(a); store.merge(a.reference.ownerKey, [snapshot(a), snapshot(b)])
    expect(store.getSnapshot().threads).toHaveLength(1)
    expect(store.getSnapshot().selected[a.reference.ownerKey]).toBe(snapshot(b).sideId)
  })
  it('rejects inventory entries owned by another parent and never erases an active send', () => {
    const store = new SideConversationsStore(), source = request()
    store.add(source); store.accept(source.id, snapshot(source), '')
    store.update(source.id, { busy: true, text: 'Sending next question' })
    store.merge(source.reference.ownerKey, [{ ...snapshot(source), messages: [] }, snapshot(request('foreign', 'other'))])
    expect(store.getSnapshot().threads).toHaveLength(1)
    expect(store.getSnapshot().threads[0]?.snapshot?.messages).toHaveLength(1)
  })
})
