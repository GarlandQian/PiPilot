import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { SideConversationService } from '../../src/main/conversations/side-conversation-service'
import type { PiRuntimeControlHandle, PiRuntimeControlLease, PiRuntimeControlSummary } from '../../src/main/pi-host/pi-runtime-frontend'
import type { CreateSideConversationInput } from '../../src/shared/side-conversations'
import { sideConversationSnapshotSchema } from '../../src/shared/side-conversations'
type Runtime = ConstructorParameters<typeof SideConversationService>[0]
const scope = { kind: 'projectless' } as const
const handle: PiRuntimeControlHandle = { hostEpoch: 1, runtimeId: 'side-runtime', generation: 1, scope, sessionId: 'side-session', sessionFile: null }
function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r }); return { resolve, promise } }
function fixture() {
  let events!: Parameters<Runtime['subscribeAllEvents']>[0]
  let ui!: Parameters<Runtime['subscribeAllUiRequests']>[0]
  let summaries!: Parameters<Runtime['subscribeControlRuntimes']>[0]
  let lifecycle: PiRuntimeControlSummary['lifecycle'] = 'running'
  let outcome: PiRuntimeControlSummary['outcome']
  let creationGate: Promise<void> | undefined
  let startupUi = false
  const lease: PiRuntimeControlLease = { ...handle, leaseId: Symbol() }
  const runtime: Runtime = {
    getActiveRuntimeIdentity: vi.fn(() => ({ runtimeId: 'parent', generation: 3, selectionRevision: 1, scope, sessionId: 'parent-session', sessionFile: '/official/parent.jsonl' })),
    acquireControlRuntime: vi.fn(async (_target, onCreated) => {
      await creationGate
      onCreated?.(handle)
      if (startupUi) await ui({ kind: 'ui_request', protocolVersion: 2, hostEpoch: 1, runtimeId: handle.runtimeId, runtimeGeneration: 1, sequence: 1, request: { type: 'extension_ui_request', id: 'dialog', method: 'confirm', title: 'Startup', message: 'Continue?' } }, handle)
      return lease
    }),
    releaseControlRuntime: vi.fn(() => true),
    discardUnpersistedControlRuntime: vi.fn(async () => undefined),
    submitControlPrompt: vi.fn(async (_handle, message) => {
      lifecycle = 'running'; outcome = undefined
      transcript.messages.push({ role: 'user', content: message, timestamp: 1 })
      return { handle: { ...handle, sessionFile: '/official/side.jsonl' }, acceptedMode: 'prompt' as const }
    }),
    getControlTranscript: vi.fn(async () => structuredClone(transcript)),
    abortControlRuntime: vi.fn(async () => { lifecycle = 'idle'; outcome = 'cancelled'; return handle }),
    respondToControlExtensionUi: vi.fn(async () => undefined),
    subscribeAllEvents: vi.fn((listener) => { events = listener; return () => true }),
    subscribeAllUiRequests: vi.fn((listener) => { ui = listener; return () => true }),
    subscribeControlRuntimes: vi.fn((listener) => { summaries = listener; return () => true }),
    listControlRuntimes: vi.fn(() => [{ ...handle, selected: false, lifecycle, queueCount: 0, outcome }]),
  }
  const transcript: Awaited<ReturnType<Runtime['getControlTranscript']>> = { messages: [] }
  const service = new SideConversationService(runtime)
  const input: CreateSideConversationInput = { scope, parentSessionId: 'parent-session', requestId: randomUUID(), question: 'Explain this source', reference: { id: 'quote', ownerKey: 'projectless:parent-session', kind: 'message', sourceId: 'source', label: 'Reply', text: 'captured immutable source' } }
  return { runtime, transcript, service, input, requestUi: () => ui({ kind: 'ui_request', protocolVersion: 2, hostEpoch: 1, runtimeId: handle.runtimeId, runtimeGeneration: 1, sequence: 2, request: { type: 'extension_ui_request', id: 'later-dialog', method: 'confirm', title: 'Continue', message: 'Continue?' } }, handle), crash: () => summaries([]), endOnly: () => events({ type: 'agent_end', messages: [], willRetry: false }, handle), settle: (result: PiRuntimeControlSummary['outcome'] = 'completed') => { lifecycle = 'idle'; outcome = result; summaries(runtime.listControlRuntimes()) }, setCreationGate: (gate: Promise<void>) => { creationGate = gate }, startupUi: () => { startupUi = true }, finish: async () => { lifecycle = 'idle'; outcome = 'completed'; await events({ type: 'agent_end', messages: [], willRetry: false }, { ...handle, sessionFile: '/official/side.jsonl' }) } }
}
async function submitted(f: ReturnType<typeof fixture>) { await expect.poll(() => vi.mocked(f.runtime.submitControlPrompt).mock.calls.length).toBe(1); await new Promise<void>((resolve) => setImmediate(resolve)) }
describe('side conversations', () => {
  it('creates a separate official runtime once and keeps immutable source metadata', async () => {
    const f = fixture(); const created = await f.service.create(f.input)
    const again = await f.service.create(f.input)
    expect(again.sideId).toBe(created.sideId)
    await submitted(f)
    expect(f.runtime.acquireControlRuntime).toHaveBeenCalledTimes(1)
    expect(f.runtime.acquireControlRuntime).toHaveBeenCalledWith({ scope }, expect.any(Function))
    expect(vi.mocked(f.runtime.submitControlPrompt).mock.calls[0]?.[1]).toContain('captured immutable source')
    expect((await f.service.get(created.sideId)).messages[0]?.text).toBe(f.input.question)
    await expect(f.service.create({ ...f.input, question: 'changed' })).rejects.toThrow('request changed')
  })
  it('refuses stale parent or stale source ownership before acquiring a runtime', async () => {
    const f = fixture()
    await expect(f.service.create({ ...f.input, parentSessionId: 'other' })).rejects.toThrow('no longer selected')
    await expect(f.service.create({ ...f.input, reference: { ...f.input.reference, ownerKey: 'old-owner' } })).rejects.toThrow('different conversation')
    expect(f.runtime.acquireControlRuntime).not.toHaveBeenCalled()
  })
  it('cancels startup extension input without submitting an invisible prompt', async () => {
    const f = fixture(); f.startupUi()
    const created = await f.service.create(f.input)
    await expect.poll(async () => (await f.service.get(created.sideId)).status).toBe('interaction_required')
    expect(f.runtime.respondToControlExtensionUi).toHaveBeenCalledWith(handle, expect.objectContaining({ cancelled: true }))
    expect(f.runtime.submitControlPrompt).not.toHaveBeenCalled()
    expect(f.runtime.releaseControlRuntime).toHaveBeenCalledTimes(1)
  })
  it('returns visible assistant text without thinking, tool results or duplicate quoted metadata', async () => {
    const f = fixture(); const created = await f.service.create(f.input); await submitted(f)
    const assistant = { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'Visible answer' }, { type: 'thinking' as const, thinking: 'private reasoning' }], api: 'test', provider: 'test', model: 'test', timestamp: 1, stopReason: 'stop' as const, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }
    f.transcript.messages.push(assistant, { role: 'toolResult', toolCallId: 'tool', toolName: 'read', content: [{ type: 'text', text: 'hidden tool content' }], timestamp: 1, isError: false })
    await f.finish()
    const snapshot = await f.service.get(created.sideId)
    expect(snapshot.status).toBe('completed')
    expect(snapshot.messages).toEqual([{ role: 'user', text: f.input.question }, { role: 'assistant', text: 'Visible answer' }])
    expect(JSON.stringify(snapshot)).not.toContain('private reasoning')
  })
  it('closing while running does not abort and captures the final answer before releasing ownership', async () => {
    const f = fixture(); const created = await f.service.create(f.input); await submitted(f)
    await f.service.release(created.sideId)
    expect(f.runtime.abortControlRuntime).not.toHaveBeenCalled()
    expect(f.runtime.releaseControlRuntime).not.toHaveBeenCalled()
    await f.finish(); await expect.poll(() => vi.mocked(f.runtime.releaseControlRuntime).mock.calls.length).toBe(1)
    expect((await f.service.get(created.sideId)).released).toBe(true)
    await expect(f.service.send({ sideId: created.sideId, text: 'next', requestId: randomUUID() })).rejects.toThrow('closed')
  })
  it('does not send a late cold-start prompt after shutdown or explicit stop', async () => {
    for (const action of ['dispose', 'abort', 'suspend'] as const) {
      const f = fixture(); const gate = deferred(); f.setCreationGate(gate.promise)
      const created = await f.service.create(f.input)
      if (action === 'abort') expect((await f.service.abort(created.sideId)).status).toBe('cancelled')
      else await f.service[action]()
      gate.resolve(); await new Promise<void>((resolve) => setImmediate(resolve))
      expect(f.runtime.submitControlPrompt).not.toHaveBeenCalled()
      if (action === 'dispose') expect(f.runtime.releaseControlRuntime).toHaveBeenCalledTimes(1)
      if (action === 'abort') expect((await f.service.get(created.sideId)).status).toBe('cancelled')
    }
  })
  it('reports explicit abort as cancelled and allows a later follow-up', async () => {
    const f = fixture(); const created = await f.service.create(f.input); await submitted(f)
    expect(sideConversationSnapshotSchema.parse(await f.service.abort(created.sideId)).status).toBe('cancelled')
    expect((await f.service.get(created.sideId)).status).toBe('cancelled')
    expect(f.runtime.abortControlRuntime).toHaveBeenCalledTimes(1)
    expect((await f.service.send({ sideId: created.sideId, text: 'Try again', requestId: randomUUID() })).status).toBe('running')
    expect(f.runtime.submitControlPrompt).toHaveBeenCalledTimes(2)
  })
  it('does not mark a pending abort complete before execution settles', async () => {
    const f = fixture(); const created = await f.service.create(f.input); await submitted(f)
    vi.mocked(f.runtime.abortControlRuntime).mockResolvedValue(handle)
    expect((await f.service.abort(created.sideId)).status).toBe('running')
    await f.service.release(created.sideId)
    expect(f.runtime.releaseControlRuntime).not.toHaveBeenCalled()
    f.settle('cancelled')
    await expect.poll(() => vi.mocked(f.runtime.releaseControlRuntime).mock.calls.length).toBe(1)
    expect((await f.service.get(created.sideId)).status).toBe('cancelled')
  })
  it.each(['completed', 'cancelled', 'failed'] as const)('preserves the %s outcome when a stop request arrives after settlement', async (outcome) => {
    const f = fixture(); const created = await f.service.create(f.input); await submitted(f)
    f.settle(outcome)
    const settled = await f.service.get(created.sideId)
    expect(settled.status).toBe(outcome)
    expect((await f.service.abort(created.sideId)).status).toBe(outcome)
    expect(f.runtime.abortControlRuntime).not.toHaveBeenCalled()
    if (outcome === 'failed') expect(settled.error).toContain('failed')
  })
  it.each(['cancelled', 'failed'] as const)('retains the %s outcome when the final transcript read fails', async (outcome) => {
    const f = fixture(); const created = await f.service.create(f.input); await submitted(f)
    await f.service.release(created.sideId)
    vi.mocked(f.runtime.getControlTranscript).mockRejectedValueOnce(new Error('final read failed'))
    f.settle(outcome)
    await expect.poll(() => vi.mocked(f.runtime.releaseControlRuntime).mock.calls.length).toBe(1)
    expect((await f.service.get(created.sideId)).status).toBe(outcome)
  })
  it('deduplicates follow-up submission even after completion and blocks overlap', async () => {
    const f = fixture(); const created = await f.service.create(f.input); await submitted(f)
    const input = { sideId: created.sideId, text: 'Follow up', requestId: randomUUID() }
    await expect(f.service.send(input)).rejects.toThrow('Wait')
    await f.finish(); await f.service.get(created.sideId)
    await f.service.send(input); await f.service.send(input)
    expect(f.runtime.submitControlPrompt).toHaveBeenCalledTimes(2)
    await expect(f.service.send({ ...input, text: 'changed' })).rejects.toThrow('request changed')
  })
  it('releases a closed conversation after Host failure even while the panel is hidden', async () => {
    const f = fixture(); const created = await f.service.create(f.input); await submitted(f)
    await f.service.release(created.sideId); f.crash()
    expect(f.runtime.releaseControlRuntime).toHaveBeenCalledTimes(1)
    expect((await f.service.get(created.sideId)).status).toBe('failed')
  })
  it('ignores an older transcript read that completes after a newer snapshot', async () => {
    const f = fixture(); const created = await f.service.create(f.input); await submitted(f)
    const gate = deferred(); const captured = structuredClone(f.transcript)
    vi.mocked(f.runtime.getControlTranscript).mockImplementationOnce(async () => { await gate.promise; return captured })
    const oldRead = f.service.get(created.sideId)
    f.transcript.messages.push({ role: 'user', content: 'newer visible message', timestamp: 2 })
    const latest = await f.service.get(created.sideId)
    expect(latest.messages[latest.messages.length - 1]?.text).toBe('newer visible message')
    gate.resolve()
    const final = await oldRead
    expect(final.messages[final.messages.length - 1]?.text).toBe('newer visible message')
  })
  it('waits for settled execution after agent_end before releasing a hidden conversation', async () => {
    const f = fixture(); const created = await f.service.create(f.input); await submitted(f)
    await f.service.release(created.sideId); await f.endOnly()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(f.runtime.releaseControlRuntime).not.toHaveBeenCalled()
    f.settle()
    await expect.poll(() => vi.mocked(f.runtime.releaseControlRuntime).mock.calls.length).toBe(1)
  })
  it('ignores a stale read failure and does not claim a running agent failed after a transient read error', async () => {
    const f = fixture(); const created = await f.service.create(f.input); await submitted(f)
    const gate = deferred()
    vi.mocked(f.runtime.getControlTranscript).mockImplementationOnce(async () => { await gate.promise; throw new Error('old failure') })
    const oldRead = f.service.get(created.sideId)
    await f.service.get(created.sideId)
    gate.resolve(); expect((await oldRead).error).toBeUndefined()
    vi.mocked(f.runtime.getControlTranscript).mockRejectedValueOnce(new Error('temporary read error'))
    const failedRead = await f.service.get(created.sideId)
    expect(failedRead.status).toBe('running'); expect(failedRead.error).toContain('refresh')
    expect((await f.service.get(created.sideId)).error).toBeUndefined()
  })
  it('does not retain a closed lease when execution settled but its final transcript cannot be read', async () => {
    const f = fixture(); const created = await f.service.create(f.input); await submitted(f)
    await f.service.release(created.sideId)
    vi.mocked(f.runtime.getControlTranscript).mockRejectedValueOnce(new Error('read failed'))
    f.settle()
    await expect.poll(() => vi.mocked(f.runtime.releaseControlRuntime).mock.calls.length).toBe(1)
    const snapshot = await f.service.get(created.sideId)
    expect(snapshot.status).toBe('completed'); expect(snapshot.error).toContain('final answer could not be loaded')
  })
  it('does not cancel extension dialogs after a saved side conversation returns to the main view', async () => {
    const f = fixture(); const created = await f.service.create(f.input); await submitted(f)
    await f.finish(); await f.service.get(created.sideId)
    vi.mocked(f.runtime.getActiveRuntimeIdentity).mockReturnValue({ ...handle, selectionRevision: 2 })
    await f.requestUi()
    expect(f.runtime.respondToControlExtensionUi).not.toHaveBeenCalled()
    await f.service.release(created.sideId)
    vi.mocked(f.runtime.getActiveRuntimeIdentity).mockReturnValue(null)
    await f.requestUi()
    expect(f.runtime.respondToControlExtensionUi).not.toHaveBeenCalled()
    expect((await f.service.get(created.sideId)).status).toBe('completed')
  })
  it('returns a valid bounded snapshot when appending after 200 visible messages', async () => {
    const f = fixture(); const created = await f.service.create(f.input); await submitted(f)
    for (let index = 0; index < 199; index += 1) f.transcript.messages.push({ role: 'user', content: `Message ${index}`, timestamp: index + 2 })
    await f.finish()
    expect((await f.service.get(created.sideId)).messages).toHaveLength(200)
    const next = await f.service.send({ sideId: created.sideId, text: 'One more', requestId: randomUUID() })
    expect(sideConversationSnapshotSchema.parse(next).messages).toHaveLength(200)
    expect(next.messages[199]?.text).toBe('One more')
    expect(f.runtime.submitControlPrompt).toHaveBeenCalledTimes(2)
  })
  it('does not recursively refresh when every transcript response republishes the same idle runtime summary', async () => {
    const f = fixture(); const created = await f.service.create(f.input); await submitted(f)
    await f.service.release(created.sideId)
    let reads = 0
    vi.mocked(f.runtime.getControlTranscript).mockImplementation(async () => {
      reads += 1
      if (reads > 3) throw new Error('recursive refresh')
      f.settle()
      return structuredClone(f.transcript)
    })
    f.settle()
    await expect.poll(() => vi.mocked(f.runtime.releaseControlRuntime).mock.calls.length).toBe(1)
    expect(reads).toBe(1)
    expect((await f.service.get(created.sideId)).status).toBe('completed')
  })
  it('preserves the first retained follow-up when compaction removes the original question', async () => {
    const f = fixture(); const created = await f.service.create(f.input); await submitted(f)
    f.transcript.messages.splice(0, f.transcript.messages.length, { role: 'user', content: 'A later retained question', timestamp: 20 })
    await f.finish()
    expect((await f.service.get(created.sideId)).messages[0]?.text).toBe('A later retained question')
  })
})
