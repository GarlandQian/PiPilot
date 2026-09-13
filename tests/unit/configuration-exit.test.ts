import { EventEmitter } from 'node:events'
import type { BrowserWindow, WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigurationDocumentRegistry } from '../../src/renderer/configuration-documents'
import { ConfigurationDocumentExitGuard } from '../../src/renderer/configuration-document-exit'
import { ConfigurationShutdownGuard } from '../../src/main/application-update/configuration-shutdown-guard'
import { ApplicationShutdownCoordinator } from '../../src/main/application-update/shutdown-coordinator'
import { applicationShutdownEventSchema } from '../../src/shared/application-shutdown'
import { appShutdownRespondContract } from '../../src/shared/ipc/contracts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
type Snapshot = { content: string; fingerprint: string }
const saved = (content: string) => ({ snapshot: { content, fingerprint: 'saved' }, apply: 'saved' as const })
async function documentHarness() {
  const registry = new ConfigurationDocumentRegistry<Snapshot>(8, 1024)
  const save = vi.fn(async (content: string, _fingerprint: string, _apply: boolean) => saved(content))
  const operations = { load: async () => ({ content: '{}', fingerprint: 'base' }), save }
  const document = registry.get('models', operations)!
  await document.load()
  return { registry, save, operations, document, guard: new ConfigurationDocumentExitGuard([registry]) }
}

afterEach(() => vi.useRealTimers())

describe('configuration document exit', () => {
  it('reports pending saves to the quit dialog and becomes clean only after acknowledgement', async () => {
    const { guard, document, save } = await documentHarness()
    document.updateDraft('captured')
    const gate = deferred<ReturnType<typeof saved>>()
    save.mockImplementationOnce(() => gate.promise)
    const states: boolean[] = []
    const unsubscribe = guard.subscribe(() => states.push(guard.isBusy()))
    const saving = document.save(false)
    expect(guard.isBusy()).toBe(true)
    expect(guard.lockIfClean()).toBe(false)
    expect(guard.discardAndLock()).toBe(false)
    gate.resolve(saved('captured'))
    await saving
    expect(guard.isBusy()).toBe(false)
    expect(states).toEqual([true, false])
    expect(guard.lockIfClean()).toBe(true)
    unsubscribe()
  })

  it('locks clean registries against edits, loads, saves and new documents until cancellation', async () => {
    const { guard, document, registry, operations, save } = await documentHarness()
    expect(guard.lockIfClean()).toBe(true)
    expect(document.updateDraft('lost edit')).toBe(false)
    expect(await document.load(true)).toBe(false)
    expect(await document.save(false)).toBeNull()
    expect(registry.get('new', operations)).toBeNull()
    guard.unlock()
    expect(document.updateDraft('allowed edit')).toBe(true)
    expect(registry.get('new', operations)).not.toBeNull()
    expect(save).not.toHaveBeenCalled()
  })

  it('saves all dirty targets without Runtime apply, then locks them', async () => {
    const { guard, document, registry, operations, save } = await documentHarness()
    const second = registry.get('mcp', operations)!
    await second.load()
    document.updateDraft('models')
    second.updateDraft('mcp')
    expect(guard.lockIfClean()).toBe(false)
    expect(await guard.saveAndLock()).toBe(true)
    expect(save.mock.calls).toEqual([['models', 'base', false], ['mcp', 'base', false]])
    expect(second.updateDraft('too late')).toBe(false)
  })

  it('preserves drafts on discard so cancelling Main cleanup can resume editing', async () => {
    const { guard, document, save } = await documentHarness()
    document.updateDraft('private draft')
    expect(guard.discardAndLock()).toBe(true)
    expect(document.getSnapshot().draftText).toBe('private draft')
    guard.unlock()
    expect(document.updateDraft('continue editing')).toBe(true)
    expect(save).not.toHaveBeenCalled()
  })

  it('does not exit after save failure or edits made during save', async () => {
    const { guard, document, save } = await documentHarness()
    document.updateDraft('captured')
    save.mockRejectedValueOnce(new Error('conflict'))
    expect(await guard.saveAndLock()).toBe(false)
    expect(document.getSnapshot().draftText).toBe('captured')
    const gate = deferred<ReturnType<typeof saved>>()
    save.mockImplementationOnce(() => gate.promise)
    const saving = guard.saveAndLock()
    expect(guard.discardAndLock()).toBe(false)
    document.updateDraft('new revision')
    gate.resolve(saved('captured'))
    expect(await saving).toBe(false)
    expect(document.getSnapshot().draftText).toBe('new revision')
  })

  it('invalidates cancelled saves and includes newly opened documents in the final check', async () => {
    const { guard, document, save, registry, operations } = await documentHarness()
    document.updateDraft('captured')
    const gate = deferred<ReturnType<typeof saved>>()
    save.mockImplementationOnce(() => gate.promise)
    const saving = guard.saveAndLock()
    guard.unlock()
    registry.get('new', operations)!.updateDraft('new target')
    gate.resolve(saved('captured'))
    expect(await saving).toBe(false)
    expect(document.updateDraft('editable')).toBe(true)
  })

  it('accepts server formatting but rejects new edits even when their text is restored', async () => {
    const { guard, document, save } = await documentHarness()
    document.updateDraft('{ }')
    save.mockResolvedValueOnce(saved('{}\n'))
    expect(await guard.saveAndLock()).toBe(true)
    guard.unlock()
    document.updateDraft('captured')
    const gate = deferred<ReturnType<typeof saved>>()
    save.mockImplementationOnce(() => gate.promise)
    const saving = guard.saveAndLock()
    document.updateDraft('other')
    document.updateDraft('captured')
    gate.resolve(saved('captured'))
    expect(await saving).toBe(false)
  })
})

function mainGuardHarness() {
  const emitter = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isCrashed: () => false, send: vi.fn(),
  })
  const contents = emitter as unknown as WebContents
  const window = { isDestroyed: () => false, webContents: contents } as BrowserWindow
  const confirmUnavailable = vi.fn(async () => false)
  const revealMainWindow = vi.fn()
  const guard = new ConfigurationShutdownGuard({
    getMainWindow: () => window, revealMainWindow, confirmUnavailable, acknowledgementTimeoutMs: 50,
  })
  const latest = () => applicationShutdownEventSchema.parse(emitter.send.mock.calls[emitter.send.mock.calls.length - 1]![1])
  return { emitter, contents, guard, latest, confirmUnavailable, revealMainWindow }
}

describe('Main shutdown guard', () => {
  it('correlates trusted contents and nonce, with only strict control data', async () => {
    const { guard, contents, emitter, latest, confirmUnavailable } = mainGuardHarness()
    const check = guard.confirm('quit')
    const event = latest()
    expect(Object.keys(event).sort()).toEqual(['intent', 'phase', 'shutdownId'])
    expect(guard.respond({} as WebContents, event.shutdownId, 'ready')).toBe(false)
    expect(guard.respond(contents, 'wrong', 'ready')).toBe(false)
    expect(guard.respond(contents, event.shutdownId, 'pending')).toBe(true)
    expect(guard.respond(contents, event.shutdownId, 'ready')).toBe(true)
    await expect(check).resolves.toBe(true)
    expect(guard.respond(contents, event.shutdownId, 'ready')).toBe(false)
    expect(emitter.listenerCount('destroyed')).toBe(0)
    guard.cancel()
    expect(latest().phase).toBe('cancel')
    expect(confirmUnavailable).not.toHaveBeenCalled()
    expect(applicationShutdownEventSchema.safeParse({ ...event, draft: 'secret' }).success).toBe(false)
    expect(appShutdownRespondContract.requestSchema.safeParse({ context: { requestId: event.shutdownId }, shutdownId: event.shutdownId, decision: 'approve-all' }).success).toBe(false)
  })

  it('uses explicit default-cancel fallback on missing acknowledgement', async () => {
    vi.useFakeTimers()
    const { guard, latest, confirmUnavailable } = mainGuardHarness()
    const check = guard.confirm('quit')
    await vi.advanceTimersByTimeAsync(51)
    await expect(check).resolves.toBe(false)
    expect(confirmUnavailable).toHaveBeenCalledOnce()
    expect(latest().phase).toBe('cancel')
  })

  it.each(['destroyed', 'render-process-gone', 'unresponsive', 'did-start-navigation'])('does not hang after acknowledged Renderer %s', async (eventName) => {
    const { guard, contents, latest, emitter, confirmUnavailable } = mainGuardHarness()
    const check = guard.confirm('install-update')
    guard.respond(contents, latest().shutdownId, 'pending')
    emitter.emit(eventName, { isMainFrame: true, isSameDocument: false })
    await expect(check).resolves.toBe(false)
    expect(confirmUnavailable).toHaveBeenCalledWith('install-update')
  })

  it('waits for a human after acknowledgement and can cancel without stopping work', async () => {
    vi.useFakeTimers()
    const { guard, contents, latest, confirmUnavailable, revealMainWindow } = mainGuardHarness()
    const check = guard.confirm('install-update')
    const event = latest()
    guard.respond(contents, event.shutdownId, 'pending')
    await vi.advanceTimersByTimeAsync(500)
    expect(confirmUnavailable).not.toHaveBeenCalled()
    expect(revealMainWindow).toHaveBeenCalledOnce()
    guard.cancel()
    await expect(check).resolves.toBe(false)
  })
})

describe('shutdown ordering', () => {
  it('deduplicates Quit before disposal and leaves cancellation retryable', async () => {
    const gate = deferred<boolean>()
    const confirm = vi.fn(() => gate.promise)
    const dispose = vi.fn()
    const quit = vi.fn()
    const cancelConfirmation = vi.fn()
    const coordinator = new ApplicationShutdownCoordinator({ confirm, dispose, quit, cancelConfirmation })
    const first = coordinator.requestQuit()
    expect(coordinator.requestQuit()).toBe(first)
    await Promise.resolve()
    expect(dispose).not.toHaveBeenCalled()
    gate.resolve(false)
    await first
    expect(coordinator.isFinalizing).toBe(false)
    expect(coordinator.currentIntent).toBeNull()
    expect(quit).not.toHaveBeenCalled()
    confirm.mockResolvedValueOnce(true)
    await coordinator.requestQuit()
    expect(dispose).toHaveBeenCalledOnce()
    expect(quit).toHaveBeenCalledOnce()
    expect(dispose.mock.invocationCallOrder[0]).toBeLessThan(quit.mock.invocationCallOrder[0]!)
  })

  it('does not install or dispose on cancellation and unlocks after failed update cleanup', async () => {
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const dispose = vi.fn().mockRejectedValueOnce(new Error('cleanup failed')).mockResolvedValue(undefined)
    const cancelConfirmation = vi.fn()
    const install = vi.fn()
    const coordinator = new ApplicationShutdownCoordinator({ confirm, dispose, quit: vi.fn(), cancelConfirmation })
    await coordinator.requestInstall(install)
    expect(dispose).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
    await expect(coordinator.requestInstall(install)).rejects.toThrow('cleanup failed')
    expect(coordinator.isFinalizing).toBe(false)
    expect(cancelConfirmation).toHaveBeenCalledTimes(2)
    await coordinator.requestInstall(install)
    expect(install).toHaveBeenCalledOnce()
  })
})
