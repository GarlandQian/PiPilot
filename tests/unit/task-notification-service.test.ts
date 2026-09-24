import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationScope, OfficialPiSessionSummary } from '../../src/shared/conversation-scope'
import type { LocalPiRuntimeSnapshot } from '../../src/shared/local-pi'
import type { PiRuntimeControlSummary } from '../../src/main/pi-host/pi-runtime-frontend'
import { TaskNotificationService, type TaskNotificationServiceOptions } from '../../src/main/notifications/task-notification-service'

const scope = { kind: 'projectless' } as const
const otherScope: ConversationScope = { kind: 'project', workspaceId: '00000000-0000-4000-8000-000000000123' }
const sessionFile = '/private/tasks/session.jsonl'
const selectionToken = 'sel_000000000000000000000001'
const roots: string[] = []
const services: TaskNotificationService[] = []
const now = Date.UTC(2026, 8, 24)

function runtimeSummary(patch: Partial<PiRuntimeControlSummary> = {}): PiRuntimeControlSummary {
  return { hostEpoch: 1, runtimeId: 'runtime-1', generation: 1, scope, sessionId: 'session-1', sessionFile, selectionToken, selected: false, lifecycle: 'idle', queueCount: 0, outcome: 'completed', ...patch }
}

class FakeRuntime {
  summaries: PiRuntimeControlSummary[] = []
  snapshot: LocalPiRuntimeSnapshot = { state: 'stopped', generation: 0, cwd: null, sessionFile: null, sessionState: null, commands: [], stderr: '', diagnostics: [], sessionStatuses: [] }
  listeners = new Set<(snapshot: LocalPiRuntimeSnapshot) => void>()
  getSnapshot = () => this.snapshot
  listControlRuntimes = () => this.summaries
  subscribe = (listener: (snapshot: LocalPiRuntimeSnapshot) => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  emit(summaries: PiRuntimeControlSummary[], statuses: LocalPiRuntimeSnapshot['sessionStatuses'] = []) {
    this.summaries = summaries
    this.snapshot = { ...this.snapshot, sessionStatuses: statuses }
    for (const listener of this.listeners) listener(this.snapshot)
  }
}

function row(token = selectionToken): OfficialPiSessionSummary {
  return { scope, sessionId: 'session-1', name: 'Private task title', preview: 'Private response', createdAt: new Date(now).toISOString(), modifiedAt: new Date(now).toISOString(), selectionToken: token }
}

async function setup(options: { foreground?: boolean; enabled?: boolean; initial?: PiRuntimeControlSummary[]; filePath?: string; currentTime?: () => number } = {}) {
  const directory = options.filePath ? undefined : await mkdtemp(join(tmpdir(), 'pipilot-notifications-'))
  if (directory) roots.push(directory)
  const filePath = options.filePath ?? join(directory!, 'task-notifications.json')
  const runtime = new FakeRuntime()
  runtime.summaries = options.initial ?? []
  let foreground = options.foreground ?? true
  let enabled = options.enabled ?? true
  const clicks: Array<() => void> = []
  const closes: Array<ReturnType<typeof vi.fn>> = []
  const show = vi.fn((_kind: string, onClick: () => void) => {
    clicks.push(onClick)
    const close = vi.fn()
    closes.push(close)
    return { close }
  })
  const catalog = {
    listControlTargets: vi.fn(async () => ({ status: 'ready', scope, revision: 1, diagnostics: [], targets: [{ scope, sessionId: 'session-1', sessionFile, createdAt: new Date(now).toISOString(), name: 'Private task title' }] })),
    revalidateControlTarget: vi.fn(async (target: unknown) => target),
    list: vi.fn(async () => ({ status: 'ready', scope, rows: [row()], nextCursor: null, diagnostics: [] })),
    resolve: vi.fn(async () => ({ mode: 'open', scope, sessionId: 'session-1', sessionFile, cwd: '/private/tasks' })),
  }
  const revealWindow = vi.fn()
  const service = new TaskNotificationService({
    filePath, runtime, catalog: catalog as unknown as TaskNotificationServiceOptions['catalog'],
    desktopEnabled: () => enabled, isWindowForeground: () => foreground, revealWindow,
    projectName: () => 'Private project', native: { supported: () => true, show }, now: options.currentTime ?? (() => now),
  })
  services.push(service)
  await service.initialize()
  return { service, runtime, filePath, show, clicks, closes, revealWindow, catalog, setForeground: (value: boolean) => { foreground = value }, setEnabled: (value: boolean) => { enabled = value } }
}

function run(runtime: FakeRuntime, outcome: 'completed' | 'failed' | 'cancelled' = 'completed', patch: Partial<PiRuntimeControlSummary> = {}) {
  runtime.emit([runtimeSummary({ ...patch, lifecycle: 'running', activity: 'prompt', outcome: undefined })])
  runtime.emit([runtimeSummary({ ...patch, outcome })])
}

async function linkedSession() {
  const directory = await mkdtemp(join(tmpdir(), 'pipilot-notification-target-'))
  roots.push(directory)
  const actual = join(directory, 'actual')
  const alias = join(directory, 'alias')
  await mkdir(actual)
  await symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const canonicalFile = join(await realpath(actual), 'session.jsonl')
  await writeFile(canonicalFile, '{"type":"session","id":"session-1"}\n')
  return { directory, aliasFile: join(alias, 'session.jsonl'), canonicalFile }
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('task notifications', () => {
  it('ignores historical completions and metadata reads, deduplicates settlement, and records subsequent runs', async () => {
    const { service, runtime } = await setup({ initial: [runtimeSummary()] })
    runtime.emit([runtimeSummary({ lifecycle: 'accepting' })])
    runtime.emit([runtimeSummary()])
    expect(service.get().items).toEqual([])
    run(runtime)
    runtime.emit([runtimeSummary()])
    expect(service.get().items.map(({ kind }) => kind)).toEqual(['completed'])
    run(runtime, 'failed')
    expect(service.get().items.map(({ kind }) => kind)).toEqual(['completed', 'failed'])
  })

  it('does not turn cancellation into completion or report an intermediate retry error', async () => {
    const { service, runtime } = await setup()
    run(runtime, 'cancelled')
    runtime.emit([runtimeSummary({ lifecycle: 'running', activity: 'retry', outcome: 'failed' })])
    expect(service.get().items).toEqual([])
    runtime.emit([runtimeSummary()])
    expect(service.get().items.map(({ kind }) => kind)).toEqual(['completed'])
  })

  it('does not announce old outcomes when queued work is cleared or a standalone question is answered', async () => {
    const { service, runtime } = await setup({ initial: [runtimeSummary()] })
    runtime.emit([runtimeSummary({ lifecycle: 'queued', queueCount: 1 })])
    runtime.emit([runtimeSummary()])
    expect(service.get().items).toEqual([])
    runtime.emit([runtimeSummary({ lifecycle: 'running', activity: 'interaction' })])
    runtime.emit([runtimeSummary()])
    expect(service.get().items.map(({ kind, resolved }) => ({ kind, resolved }))).toEqual([{ kind: 'input-required', resolved: true }])
  })

  it('marks a viewed task read without desktop delivery and leaves other foreground tasks unread', async () => {
    const { service, runtime, show } = await setup()
    service.setPresentation({ scope, sessionId: 'session-1' })
    run(runtime, 'completed', { selected: true })
    run(runtime, 'failed', { selected: false, scope: otherScope })
    expect(service.get().items.map(({ read }) => read)).toEqual([true, false])
    expect(show).not.toHaveBeenCalled()
  })

  it('does not mark a notice read before Renderer confirms the selected conversation is presented', async () => {
    const { service, runtime } = await setup()
    run(runtime, 'completed', { selected: true })
    expect(service.get().items[0].read).toBe(false)
    service.setPresentation({ scope: otherScope, sessionId: 'session-1' })
    expect(service.get().items[0].read).toBe(false)
    service.setPresentation({ scope, sessionId: 'session-1' })
    expect(service.get().items[0].read).toBe(true)
  })

  it('does not mark a physical copy read merely because the selected task has the same session ID', async () => {
    const { service, runtime } = await setup()
    run(runtime)
    runtime.emit([runtimeSummary({ runtimeId: 'runtime-copy', sessionFile: '/private/tasks/copy.jsonl', selected: true })])
    service.setPresentation({ scope, sessionId: 'session-1' })
    expect(service.get().items[0].read).toBe(false)
  })

  it('notifies a hidden selected task, supports desktop opt-out and marks read on visible presentation', async () => {
    const { service, runtime, show, setForeground, setEnabled, closes } = await setup({ foreground: false })
    service.setPresentation({ scope, sessionId: 'session-1' })
    run(runtime, 'completed', { selected: true })
    expect(show).toHaveBeenCalledWith('completed', expect.any(Function))
    expect(service.get().items[0].read).toBe(false)
    setForeground(true)
    service.refreshPresentation()
    expect(service.get().items[0].read).toBe(true)
    expect(closes[0]).toHaveBeenCalledOnce()
    setForeground(false)
    setEnabled(false)
    run(runtime, 'failed', { selected: true })
    expect(service.get().items[1].read).toBe(false)
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('does not reuse the old presentation during a renderer reload or crash', async () => {
    const { service, runtime } = await setup()
    service.setPresentation({ scope, sessionId: 'session-1' })
    service.setPresentation({ scope: null, sessionId: null })
    run(runtime, 'completed', { selected: true })
    service.refreshPresentation()
    expect(service.get().items[0].read).toBe(false)
    service.setPresentation({ scope, sessionId: 'session-1' })
    expect(service.get().items[0].read).toBe(true)
  })

  it('keeps input actionable when read, resolves it from runtime state, and notifies a later question', async () => {
    const { service, runtime } = await setup()
    runtime.emit([runtimeSummary({ lifecycle: 'running', activity: 'interaction', outcome: undefined })])
    runtime.emit([runtimeSummary({ lifecycle: 'running', activity: 'interaction', outcome: undefined })])
    expect(service.get().items).toHaveLength(1)
    service.markRead(service.get().items[0].id)
    expect(service.get().items[0]).toMatchObject({ read: true, resolved: false })
    runtime.emit([runtimeSummary({ lifecycle: 'running', activity: 'prompt', outcome: undefined })])
    expect(service.get().items[0]).toMatchObject({ read: true, resolved: true })
    runtime.emit([runtimeSummary({ lifecycle: 'running', activity: 'interaction', outcome: undefined })])
    expect(service.get().items.map(({ resolved }) => resolved)).toEqual([true, false])
    runtime.emit([runtimeSummary({ lifecycle: 'running', activity: 'prompt', outcome: undefined })])
    expect(service.get().items[1]).toMatchObject({ resolved: true, read: false })
  })

  it('reports host crash from retained failure status and never duplicates it', async () => {
    const { service, runtime } = await setup()
    runtime.emit([runtimeSummary({ lifecycle: 'running', activity: 'prompt', outcome: undefined })])
    const statuses = [{ scope, sessionId: 'session-1', selectionToken, status: 'failed' as const }]
    runtime.emit([], statuses)
    runtime.emit([], statuses)
    expect(service.get().items.map(({ kind }) => kind)).toEqual(['failed'])
  })

  it('queues a native click without changing task selection and resolves an exact physical target', async () => {
    const { service, runtime, clicks, revealWindow, catalog } = await setup({ foreground: false })
    run(runtime)
    const id = service.get().items[0].id
    clicks[0]()
    expect(revealWindow).toHaveBeenCalledOnce()
    expect(service.get().requestedId).toBe(id)
    expect(catalog.resolve).not.toHaveBeenCalled()
    expect(await service.resolveTarget(id)).toEqual(row())
    expect(catalog.revalidateControlTarget).toHaveBeenCalledOnce()
    expect(service.get()).toMatchObject({ requestedId: null, items: [{ id, read: false }] })
    expect(JSON.stringify(service.get())).not.toContain(sessionFile)
  })

  it('does not route by duplicate session ID and consumes an unavailable native-click target', async () => {
    const { service, runtime, clicks, catalog } = await setup({ foreground: false })
    run(runtime)
    clicks[0]()
    catalog.listControlTargets.mockResolvedValueOnce({ status: 'ready', scope, revision: 2, diagnostics: [], targets: [{ scope, sessionId: 'session-1', sessionFile: '/private/tasks/copy.jsonl', createdAt: new Date(now).toISOString(), name: 'Copy' }] })
    await expect(service.resolveTarget(service.get().items[0].id)).rejects.toMatchObject({ code: 'NOTIFICATION_TARGET_UNAVAILABLE' })
    expect(service.get().requestedId).toBeNull()
    expect(service.get().items[0].read).toBe(false)
    expect(catalog.resolve).not.toHaveBeenCalled()
  })

  it('checks each duplicate catalog row against the private file target', async () => {
    const { service, runtime, catalog } = await setup()
    run(runtime)
    const wrongToken = 'sel_000000000000000000000002'
    catalog.list.mockResolvedValueOnce({ status: 'ready', scope, rows: [row(wrongToken), row()], nextCursor: null, diagnostics: [] })
    catalog.resolve.mockResolvedValueOnce({ mode: 'open', scope, sessionId: 'session-1', sessionFile: '/private/tasks/copy.jsonl', cwd: '/private/tasks' })
    expect(await service.resolveTarget(service.get().items[0].id)).toEqual(row())
    expect(catalog.resolve).toHaveBeenCalledTimes(2)
  })

  it('canonicalizes a symlinked session directory without delaying notification delivery or losing read/input matching', async () => {
    const { aliasFile, canonicalFile } = await linkedSession()
    const { service, runtime, catalog, show, setForeground, filePath } = await setup({ foreground: false })
    catalog.listControlTargets.mockResolvedValue({ status: 'ready', scope, revision: 1, diagnostics: [], targets: [
      { scope, sessionId: 'session-1', sessionFile: canonicalFile, createdAt: new Date(now).toISOString(), name: 'Linked task' },
    ] })
    catalog.resolve.mockResolvedValue({ mode: 'open', scope, sessionId: 'session-1', sessionFile: canonicalFile, cwd: '/private/tasks' })
    run(runtime, 'completed', { sessionFile: aliasFile, selected: true })
    const id = service.get().items[0].id
    expect(show).toHaveBeenCalledOnce()
    expect(service.get().items[0]).toMatchObject({ read: false })
    await vi.waitFor(() => expect(service.get().items[0]).toMatchObject({ sessionName: 'Linked task', catalogId: expect.any(String) }))
    expect(await service.resolveTarget(id)).toEqual(row())
    expect(catalog.revalidateControlTarget).toHaveBeenCalledWith(expect.objectContaining({ sessionFile: canonicalFile }))
    setForeground(true)
    service.setPresentation({ scope, sessionId: 'session-1' })
    expect(service.get().items[0].read).toBe(true)

    runtime.emit([runtimeSummary({ sessionFile: aliasFile, selected: true, lifecycle: 'running', activity: 'interaction' })])
    await vi.waitFor(() => expect(service.get().items[1].catalogId).toBeDefined())
    runtime.emit([runtimeSummary({ sessionFile: aliasFile, selected: true })])
    expect(service.get().items[1]).toMatchObject({ kind: 'input-required', read: true, resolved: true })
    await service.dispose()
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    expect(persisted.records.map((record: { sessionFile: string }) => record.sessionFile)).toEqual([canonicalFile, canonicalFile])
    expect(JSON.stringify(service.get())).not.toContain(canonicalFile)
  })

  it('restores an aliased private target and reads it only when its canonical physical task is presented', async () => {
    const { aliasFile, canonicalFile } = await linkedSession()
    const first = await setup({ foreground: false })
    run(first.runtime)
    await first.service.dispose()
    const persisted = JSON.parse(await readFile(first.filePath, 'utf8'))
    persisted.records[0].sessionFile = aliasFile
    delete persisted.records[0].item.catalogId
    await writeFile(first.filePath, JSON.stringify(persisted))
    const { service, runtime, catalog } = await setup({
      filePath: first.filePath,
      initial: [runtimeSummary({ sessionFile: join(dirname(canonicalFile), 'copy.jsonl'), selected: true })],
    })
    service.setPresentation({ scope, sessionId: 'session-1' })
    catalog.listControlTargets.mockResolvedValue({ status: 'ready', scope, revision: 1, diagnostics: [], targets: [
      { scope, sessionId: 'session-1', sessionFile: canonicalFile, createdAt: new Date(now).toISOString(), name: 'Linked task' },
    ] })
    catalog.resolve.mockResolvedValue({ mode: 'open', scope, sessionId: 'session-1', sessionFile: canonicalFile, cwd: '/private/tasks' })
    expect(await service.resolveTarget(service.get().items[0].id)).toEqual(row())
    expect(service.get().items[0].read).toBe(false)
    runtime.emit([runtimeSummary({ sessionFile: canonicalFile, selected: true })])
    service.setPresentation({ scope, sessionId: 'session-1' })
    expect(service.get().items[0].read).toBe(true)
  })

  it('does not follow a session-file symlink to a different catalog target', async () => {
    const { directory, canonicalFile } = await linkedSession()
    const fileLink = join(directory, 'linked-session.jsonl')
    await symlink(canonicalFile, fileLink, 'file')
    const { service, runtime, catalog } = await setup()
    catalog.listControlTargets.mockResolvedValue({ status: 'ready', scope, revision: 1, diagnostics: [], targets: [
      { scope, sessionId: 'session-1', sessionFile: canonicalFile, createdAt: new Date(now).toISOString(), name: 'Actual task' },
    ] })
    run(runtime, 'completed', { sessionFile: fileLink })
    await expect(service.resolveTarget(service.get().items[0].id)).rejects.toMatchObject({ code: 'NOTIFICATION_TARGET_UNAVAILABLE' })
    expect(catalog.revalidateControlTarget).not.toHaveBeenCalled()
    expect(service.get().items[0].read).toBe(false)
  })

  it('flushes an in-flight canonical private target when the app quits immediately after completion', async () => {
    const { aliasFile, canonicalFile } = await linkedSession()
    const { service, runtime, filePath } = await setup()
    run(runtime, 'completed', { sessionFile: aliasFile })
    await service.dispose()
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    expect(persisted.records[0].sessionFile).toBe(canonicalFile)
  })

  it('does not retarget a notification when a replacement file reuses its path and session ID', async () => {
    const { service, runtime, catalog } = await setup()
    run(runtime)
    await vi.waitFor(() => expect(service.get().items[0].catalogId).toBeDefined())
    catalog.listControlTargets.mockResolvedValueOnce({ status: 'ready', scope, revision: 2, diagnostics: [], targets: [{ scope, sessionId: 'session-1', sessionFile, createdAt: new Date(now + 1_000).toISOString(), name: 'Replacement task' }] })
    await expect(service.resolveTarget(service.get().items[0].id)).rejects.toMatchObject({ code: 'NOTIFICATION_TARGET_UNAVAILABLE' })
    expect(catalog.resolve).not.toHaveBeenCalled()
    expect(service.get().items[0].read).toBe(false)
  })

  it('enriches title and catalog identity only from the exact physical target without delaying delivery', async () => {
    const { service, runtime, catalog, show } = await setup({ foreground: false })
    let finish: (value: Awaited<ReturnType<typeof catalog.listControlTargets>>) => void = () => undefined
    catalog.listControlTargets.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    run(runtime)
    const id = service.get().items[0].id
    expect(show).toHaveBeenCalledOnce()
    expect(service.get().items[0].catalogId).toBeUndefined()
    finish({ status: 'ready', scope, revision: 1, diagnostics: [], targets: [
      { scope, sessionId: 'session-1', sessionFile: '/private/tasks/copy.jsonl', createdAt: new Date(now).toISOString(), name: 'Wrong copy' },
      { scope, sessionId: 'session-1', sessionFile, createdAt: new Date(now).toISOString(), name: 'Correct task' },
    ] })
    await vi.waitFor(() => expect(service.get().items[0]).toMatchObject({ id, read: false, sessionName: 'Correct task', catalogId: `cat_${createHash('sha256').update(JSON.stringify(['projectless', sessionFile, 'session-1', new Date(now).toISOString()])).digest('hex')}` }))
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('closes desktop handles on explicit read or clear without treating target resolution as read', async () => {
    const { service, runtime, closes } = await setup({ foreground: false })
    run(runtime)
    const first = service.get().items[0].id
    await service.resolveTarget(first)
    expect(service.get().items[0].read).toBe(false)
    expect(closes[0]).not.toHaveBeenCalled()
    service.markRead(first)
    expect(closes[0]).toHaveBeenCalledOnce()
    run(runtime, 'failed')
    service.clear(service.get().items[1].id)
    expect(closes[1]).toHaveBeenCalledOnce()
  })

  it('persists private targets atomically and restores read state while resolving previous-process questions', async () => {
    const first = await setup()
    run(first.runtime)
    first.service.markRead()
    first.runtime.emit([runtimeSummary({ lifecycle: 'running', activity: 'interaction', outcome: undefined })])
    await first.service.dispose()
    if (process.platform !== 'win32') {
      // Windows does not expose the POSIX mode bits passed to Node's writeFile.
      expect((await stat(first.filePath)).mode & 0o777).toBe(0o600)
    }
    const persisted = JSON.parse(await readFile(first.filePath, 'utf8'))
    expect(persisted.records[0].sessionFile).toBe(sessionFile)
    const restored = await setup({ filePath: first.filePath })
    expect(restored.service.get().items).toEqual([
      expect.objectContaining({ kind: 'completed', read: true }),
      expect.objectContaining({ kind: 'input-required', resolved: true, read: false }),
    ])
    expect(restored.show).not.toHaveBeenCalled()
  })

  it('retains only the latest 100 events and 30 days, and survives malformed persistence', async () => {
    let timestamp = now
    const { service, runtime, filePath } = await setup({ currentTime: () => timestamp })
    for (let index = 0; index < 102; index += 1) { timestamp += 1; run(runtime) }
    expect(service.get().items).toHaveLength(100)
    timestamp += 31 * 24 * 60 * 60 * 1000
    run(runtime)
    expect(service.get().items).toHaveLength(1)
    await service.dispose()
    await writeFile(filePath, '{ broken')
    const restored = await setup({ filePath })
    expect(restored.service.get().items).toEqual([])
  })

  it('isolates native delivery and listener failure from task updates and cleans up on disposal', async () => {
    const { service, runtime, show } = await setup({ foreground: false })
    show.mockImplementationOnce(() => { throw new Error('OS denied delivery') })
    service.subscribe(() => { throw new Error('Renderer gone') })
    expect(() => run(runtime)).not.toThrow()
    expect(service.get().items).toHaveLength(1)
    service.clear()
    expect(service.get().items).toEqual([])
    await service.dispose()
    expect(runtime.listeners.size).toBe(0)
  })

  it('keeps native-click window errors isolated and preserves the queued navigation request', async () => {
    const { service, runtime, clicks, revealWindow } = await setup({ foreground: false })
    run(runtime)
    revealWindow.mockImplementationOnce(() => { throw new Error('Window destroyed') })
    expect(() => clicks[0]()).not.toThrow()
    expect(service.get().requestedId).toBe(service.get().items[0].id)
  })
})
