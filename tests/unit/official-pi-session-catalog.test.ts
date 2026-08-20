import { randomUUID } from 'node:crypto'
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  SESSION_CATALOG_MAX_CANDIDATES,
  SESSION_CATALOG_MAX_CONCURRENT_READERS,
  SESSION_CATALOG_MAX_FILE_BYTES,
  SESSION_CATALOG_MAX_PAGE_ROWS,
  SESSION_CATALOG_MAX_REFRESH_BYTES,
  type ConversationScope,
} from '../../src/shared/conversation-scope'
import type {
  LocalPiRuntimeSnapshot,
  LocalPiSessionState,
} from '../../src/shared/local-pi'
import { ConversationScopeResolver } from '../../src/main/conversations/conversation-scope-resolver'
import {
  OfficialPiSessionCatalog,
  OfficialPiSessionCatalogError,
  SESSION_CATALOG_REFRESH_FOREGROUND_MAX_SCANS,
  type OfficialPiSessionCatalogOptions,
} from '../../src/main/conversations/official-pi-session-catalog'
import {
  OfficialPiSessionActivationError,
  OfficialPiSessionActivationService,
} from '../../src/main/conversations/official-pi-session-activation-service'
import { ObservedPiSessionDirectoryRepository } from '../../src/main/repositories/observed-pi-session-directory-repository'
import type { PiRuntimeFrontend } from '../../src/main/pi-host/pi-runtime-frontend'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const scope: ConversationScope = { kind: 'project', workspaceId }

interface SessionFixtureOptions {
  cwd: string
  id: string
  parentSession?: string
  name?: string
  timestamp?: string
  activityAt?: number
  preview?: string
  version?: number
}

async function writeSession(filePath: string, options: SessionFixtureOptions) {
  const timestamp = options.timestamp ?? '2026-08-08T00:00:00.000Z'
  const entries: unknown[] = [
    {
      type: 'session',
      version: options.version ?? 3,
      id: options.id,
      timestamp,
      cwd: options.cwd,
      ...(options.parentSession ? { parentSession: options.parentSession } : {}),
    },
    {
      type: 'message',
      id: randomUUID(),
      parentId: null,
      timestamp,
      message: {
        role: 'user',
        content: options.preview ?? `prompt ${options.id}`,
        ...(options.activityAt ? { timestamp: options.activityAt } : {}),
      },
    },
  ]
  if (options.name !== undefined) {
    entries.push({
      type: 'session_info',
      id: randomUUID(),
      parentId: null,
      timestamp,
      name: 'stale name',
    })
    entries.push({
      type: 'session_info',
      id: randomUUID(),
      parentId: null,
      timestamp,
      name: options.name,
    })
  }
  await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
}

async function createCatalogFixture(
  options: OfficialPiSessionCatalogOptions = {},
) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'pipilot-catalog-'))
  const root = await realpath(temporaryRoot)
  const cwd = join(root, 'project')
  const sessionDirectory = join(root, 'sessions')
  const projectlessCwd = join(root, 'general-chat', 'workspace')
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(sessionDirectory, { recursive: true }),
  ])
  const resolver = new ConversationScopeResolver(
    {
      getLocation(id) {
        return id === workspaceId
          ? { id, name: 'project', path: cwd }
          : undefined
      },
    },
    projectlessCwd,
  )
  const observations = new ObservedPiSessionDirectoryRepository(
    join(root, 'observed.json'),
  )
  await observations.initialize()
  const catalog = new OfficialPiSessionCatalog(resolver, observations, options)
  return {
    catalog,
    cwd,
    observations,
    projectlessCwd,
    resolver,
    root,
    sessionDirectory,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function sessionState(
  sessionId: string,
  sessionFile: string | undefined,
): LocalPiSessionState {
  return {
    thinkingLevel: 'off',
    isStreaming: false,
    isCompacting: false,
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    ...(sessionFile ? { sessionFile } : {}),
    sessionId,
    autoCompactionEnabled: true,
    messageCount: 1,
    pendingMessageCount: 0,
  }
}

function runtimeSnapshot(
  cwd: string,
  state: LocalPiSessionState,
): LocalPiRuntimeSnapshot {
  return {
    state: 'ready',
    generation: 2,
        cwd,
    sessionFile: state.sessionFile ?? null,
    sessionState: state,
    commands: [],
    stderr: '',
    diagnostics: [],
  }
}

type ActivationHost = ConstructorParameters<
  typeof OfficialPiSessionActivationService
>[3]

type BaseActivationHost = Pick<
  PiRuntimeFrontend,
  'getSnapshot' | 'getState' | 'replace' | 'start' | 'stop'
>

function activationHost(
  host: BaseActivationHost,
  activeScope: ConversationScope = scope,
): ActivationHost & {
  rollbackSelection: ReturnType<typeof vi.fn>
  renameSession: ReturnType<typeof vi.fn>
} {
  const rollbackSelection = vi.fn(async () => true)
  const renameSession = vi.fn(async (
    _scope: ConversationScope,
    _sessionFile: string,
    name: string,
  ) => {
    const snapshot = host.getSnapshot()
    return {
      sessionId: snapshot.sessionState?.sessionId ?? 'unknown-session',
      name,
    }
  })
  return {
    ...host,
    getActiveRuntimeIdentity: () => {
      const snapshot = host.getSnapshot()
      if (snapshot.state !== 'ready') return null
      return {
        runtimeId: 'rt-test',
        generation: snapshot.generation,
        selectionRevision: 1,
        scope: structuredClone(activeScope),
        sessionFile: snapshot.sessionFile,
        sessionId: snapshot.sessionState?.sessionId ?? null,
      }
    },
    renameSession,
    rollbackSelection,
  }
}

function runtimeIdentity(
  host: ActivationHost,
  generation = host.getSnapshot().generation,
) {
  const snapshot = host.getSnapshot()
  return {
    runtimeId: 'rt-test',
    generation,
    selectionRevision: 1,
    scope,
    sessionFile: snapshot.sessionFile,
    sessionId: snapshot.sessionState?.sessionId ?? null,
  }
}

describe('OfficialPiSessionCatalog', () => {
  it('uses the fixed catalog bounds', () => {
    expect(SESSION_CATALOG_MAX_CANDIDATES).toBe(200)
    expect(SESSION_CATALOG_MAX_FILE_BYTES).toBe(64 * 1_024 * 1_024)
    expect(SESSION_CATALOG_MAX_REFRESH_BYTES).toBe(256 * 1_024 * 1_024)
    expect(SESSION_CATALOG_MAX_CONCURRENT_READERS).toBe(8)
    expect(SESSION_CATALOG_MAX_PAGE_ROWS).toBe(50)
  })

  it('returns notLoaded without guessing a Pi directory', async () => {
    const fixture = await createCatalogFixture()
    try {
      await expect(fixture.catalog.list(scope)).resolves.toEqual({
        status: 'notLoaded',
        scope,
        rows: [],
        nextCursor: null,
        diagnostics: [],
      })
      await expect(fixture.catalog.listControlTargets(scope)).resolves.toEqual({
        status: 'notLoaded',
        scope,
        revision: 0,
        targets: [],
        diagnostics: [],
      })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('revalidates Main-only control targets across append-only growth', async () => {
    const fixture = await createCatalogFixture()
    const sessionFile = join(fixture.sessionDirectory, 'controlled.jsonl')
    try {
      await writeSession(sessionFile, {
        cwd: fixture.cwd,
        id: 'controlled-session',
        name: 'Controlled session',
      })
      await fixture.observations.observe(scope, sessionFile)

      const inventory = await fixture.catalog.listControlTargets(scope)
      expect(inventory).toMatchObject({
        status: 'ready',
        scope,
        targets: [{
          sessionId: 'controlled-session',
          sessionFile: await realpath(sessionFile),
          mode: 'open',
          name: 'Controlled session',
        }],
      })
      const target = inventory.targets[0]
      if (!target) throw new Error('Expected a control target.')
      expect(target).not.toHaveProperty('selectionToken')
      expect(target).not.toHaveProperty('preview')

      await appendFile(sessionFile, `${JSON.stringify({
        type: 'message',
        id: randomUUID(),
        parentId: null,
        timestamp: '2026-08-08T00:01:00.000Z',
        message: { role: 'assistant', content: 'A later response.' },
      })}\n`)
      await expect(fixture.catalog.revalidateControlTarget(target)).resolves
        .toMatchObject({ sessionId: 'controlled-session' })

      await writeSession(sessionFile, {
        cwd: fixture.cwd,
        id: 'replacement-session',
      })
      await expect(fixture.catalog.revalidateControlTarget(target)).rejects
        .toMatchObject({ code: 'SESSION_CATALOG_SELECTION_STALE' })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('coalesces explicit refreshes while honoring lifecycle invalidation', async () => {
    const fixture = await createCatalogFixture()
    const sessionFile = join(fixture.sessionDirectory, 'refresh-race.jsonl')
    let releaseFirstScan!: () => void
    let releaseSecondScan!: () => void
    const firstScanGate = new Promise<void>((resolve) => {
      releaseFirstScan = resolve
    })
    const secondScanGate = new Promise<void>((resolve) => {
      releaseSecondScan = resolve
    })
    let signalFirstScan!: () => void
    let signalSecondScan!: () => void
    const firstScanStarted = new Promise<void>((resolve) => {
      signalFirstScan = resolve
    })
    const secondScanStarted = new Promise<void>((resolve) => {
      signalSecondScan = resolve
    })

    try {
      await writeSession(sessionFile, {
        cwd: fixture.cwd,
        id: 'refresh-race',
        name: 'before refresh',
      })
      await fixture.observations.observe(scope, sessionFile)
      const initial = await fixture.catalog.list(scope)
      expect(initial.rows[0]?.name).toBe('before refresh')

      await writeFile(sessionFile, `${JSON.stringify({
        type: 'session_info',
        id: randomUUID(),
        parentId: null,
        timestamp: '2026-08-08T00:00:01.000Z',
        name: 'after refresh',
      })}\n`, { flag: 'a' })

      const originalResolve = fixture.resolver.resolve.bind(fixture.resolver)
      let resolveCalls = 0
      const resolveSpy = vi.spyOn(fixture.resolver, 'resolve')
        .mockImplementation(async (requestedScope) => {
          resolveCalls += 1
          if (resolveCalls === 1) {
            signalFirstScan()
            await firstScanGate
          } else if (resolveCalls === 2) {
            signalSecondScan()
            await secondScanGate
          }
          return originalResolve(requestedScope)
        })

      const firstRefresh = fixture.catalog.refresh(scope)
      await firstScanStarted
      const joinedRefresh = fixture.catalog.refresh(scope)

      // A real lifecycle change still supersedes the first scan and requires a
      // retry. A later explicit refresh must join that retry instead of making
      // it stale again.
      fixture.catalog.invalidate(scope)
      releaseFirstScan()
      await secondScanStarted
      const joinedRetry = fixture.catalog.refresh(scope)
      releaseSecondScan()

      const results = await Promise.all([
        firstRefresh,
        joinedRefresh,
        joinedRetry,
      ])
      expect(resolveSpy).toHaveBeenCalledTimes(2)
      expect(results.map((result) => result.rows[0]?.name)).toEqual([
        'after refresh',
        'after refresh',
        'after refresh',
      ])
      const tokens = results.map((result) => result.rows[0]?.selectionToken)
      expect(new Set(tokens).size).toBe(1)
      expect(tokens[0]).toBe(initial.rows[0]?.selectionToken)

      const row = results[0].rows[0]
      if (!row) throw new Error('Expected a refreshed catalog row.')
      await expect(
        fixture.catalog.resolve(scope, row.selectionToken),
      ).resolves.toMatchObject({
        scope,
        cwd: fixture.cwd,
        sessionId: 'refresh-race',
        sessionFile,
      })

      fixture.catalog.invalidate(scope)
      await expect(
        fixture.catalog.resolve(scope, row.selectionToken),
      ).resolves.toMatchObject({
        scope,
        cwd: fixture.cwd,
        sessionId: 'refresh-race',
        sessionFile,
      })
    } finally {
      releaseFirstScan()
      releaseSecondScan()
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('publishes within the foreground budget and continues a dirty refresh in the background', async () => {
    const continuationGate = deferred<void>()
    const yieldRefreshContinuation = vi.fn(() => continuationGate.promise)
    const fixture = await createCatalogFixture({
      now: () => 0,
      yieldRefreshContinuation,
    })
    const sessionFile = join(fixture.sessionDirectory, 'dirty-burst.jsonl')
    const dirtyScanCount = SESSION_CATALOG_REFRESH_FOREGROUND_MAX_SCANS
    const totalScanCount = dirtyScanCount + 1
    const scanGates = Array.from({ length: totalScanCount }, () => deferred<void>())
    const scanStarts = Array.from({ length: totalScanCount }, () => deferred<void>())
    let foregroundRefresh: ReturnType<OfficialPiSessionCatalog['refresh']> | null = null
    let joinedForeground: ReturnType<OfficialPiSessionCatalog['refresh']> | null = null
    let joinedBackground: ReturnType<OfficialPiSessionCatalog['refresh']> | null = null

    try {
      await writeSession(sessionFile, {
        cwd: fixture.cwd,
        id: 'dirty-burst',
        name: 'before burst',
      })
      await fixture.observations.observe(scope, sessionFile)
      const initial = await fixture.catalog.list(scope)
      await writeFile(sessionFile, `${JSON.stringify({
        type: 'session_info',
        id: randomUUID(),
        parentId: null,
        timestamp: '2026-08-08T00:00:01.000Z',
        name: 'after burst',
      })}\n`, { flag: 'a' })

      const originalResolve = fixture.resolver.resolve.bind(fixture.resolver)
      let resolveCalls = 0
      const resolveSpy = vi.spyOn(fixture.resolver, 'resolve')
        .mockImplementation(async (requestedScope) => {
          const scanIndex = resolveCalls
          resolveCalls += 1
          scanStarts[scanIndex]?.resolve()
          await scanGates[scanIndex]?.promise
          return originalResolve(requestedScope)
        })

      foregroundRefresh = fixture.catalog.refresh(scope)
      for (let index = 0; index < dirtyScanCount; index += 1) {
        await scanStarts[index]?.promise
        fixture.catalog.invalidate(scope)
        if (index === 1) joinedForeground = fixture.catalog.refresh(scope)
        scanGates[index]?.resolve()
      }

      const foregroundResults = await Promise.all([
        foregroundRefresh,
        joinedForeground,
      ])
      expect(resolveSpy).toHaveBeenCalledTimes(dirtyScanCount)
      expect(yieldRefreshContinuation).toHaveBeenCalledTimes(1)
      expect(foregroundResults.map((result) => result?.rows[0]?.name)).toEqual(
        ['after burst', 'after burst'],
      )
      expect(new Set(
        foregroundResults.map((result) => result?.rows[0]?.selectionToken),
      ).size).toBe(1)
      expect(foregroundResults[0]?.rows[0]?.selectionToken).toBe(
        initial.rows[0]?.selectionToken,
      )

      continuationGate.resolve()
      await scanStarts[dirtyScanCount]?.promise
      joinedBackground = fixture.catalog.refresh(scope)
      scanGates[dirtyScanCount]?.resolve()
      await expect(joinedBackground).resolves.toMatchObject({
        status: 'ready',
        rows: [expect.objectContaining({
          name: 'after burst',
          selectionToken: initial.rows[0]?.selectionToken,
        })],
      })
      expect(resolveSpy).toHaveBeenCalledTimes(totalScanCount)
    } finally {
      continuationGate.resolve()
      for (const gate of scanGates) gate.resolve()
      const pendingRefreshes: Promise<unknown>[] = []
      for (const refresh of [
        foregroundRefresh,
        joinedForeground,
        joinedBackground,
      ]) {
        if (refresh) pendingRefreshes.push(refresh)
      }
      await Promise.allSettled(pendingRefreshes)
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('cleans up a failed coordinator so the next catalog request can recover', async () => {
    let tokenGenerationAvailable = false
    const fixture = await createCatalogFixture({
      createId: () => tokenGenerationAvailable ? randomUUID() : 'invalid',
    })
    const sessionFile = join(fixture.sessionDirectory, 'failed-refresh.jsonl')
    try {
      await writeSession(sessionFile, {
        cwd: fixture.cwd,
        id: 'failed-refresh',
        name: 'recovered refresh',
      })
      await fixture.observations.observe(scope, sessionFile)

      await expect(fixture.catalog.list(scope)).rejects.toThrow(
        'Could not create a unique catalog token.',
      )
      tokenGenerationAvailable = true
      await expect(fixture.catalog.list(scope)).resolves.toMatchObject({
        status: 'ready',
        rows: [expect.objectContaining({
          sessionId: 'failed-refresh',
          name: 'recovered refresh',
        })],
      })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('streams current v3 rows through EOF and isolates invalid direct files', async () => {
    const fixture = await createCatalogFixture()
    const firstFile = join(fixture.sessionDirectory, 'first.jsonl')
    const duplicateFile = join(fixture.sessionDirectory, 'duplicate.jsonl')
    const mismatchFile = join(fixture.sessionDirectory, 'mismatch.jsonl')
    const unsupportedFile = join(fixture.sessionDirectory, 'unsupported.jsonl')
    const malformedFile = join(fixture.sessionDirectory, 'malformed.jsonl')
    const invalidIdFile = join(fixture.sessionDirectory, 'invalid-id.jsonl')
    const outsideFile = join(fixture.root, 'outside.jsonl')
    const duplicateId = 'duplicate-session'

    try {
      await Promise.all([
        writeSession(firstFile, {
          cwd: fixture.cwd,
          id: duplicateId,
          name: 'latest name',
          preview: '  first\n user   prompt  ',
          activityAt: Date.UTC(2026, 7, 8, 1, 0, 0),
        }),
        writeSession(duplicateFile, {
          cwd: fixture.cwd,
          id: duplicateId,
          preview: 'second prompt',
          activityAt: Date.UTC(2026, 7, 8, 2, 0, 0),
        }),
        writeSession(mismatchFile, {
          cwd: fixture.root,
          id: 'wrong-scope',
        }),
        writeSession(unsupportedFile, {
          cwd: fixture.cwd,
          id: 'old-version',
          version: 2,
        }),
        writeFile(malformedFile, '{not-json}\n'),
        writeSession(invalidIdFile, {
          cwd: fixture.cwd,
          id: '/Users/private/session',
        }),
        writeSession(outsideFile, {
          cwd: fixture.cwd,
          id: 'outside',
        }),
      ])
      await symlink(outsideFile, join(fixture.sessionDirectory, 'linked.jsonl'))
      await fixture.observations.observe(scope, firstFile)

      const result = await fixture.catalog.list(scope)
      expect(result.status).toBe('ready')
      expect(result.rows).toHaveLength(2)
      expect(result.rows.map((row) => row.sessionId)).toEqual([
        duplicateId,
        duplicateId,
      ])
      expect(result.rows[0]?.preview).toBe('second prompt')
      expect(result.rows[1]).toMatchObject({
        name: 'latest name',
        preview: 'first user prompt',
      })
      expect(new Set(result.rows.map((row) => row.selectionToken)).size).toBe(2)
      const serializedResult = JSON.stringify(result)
      expect(serializedResult).not.toContain(fixture.root)
      expect(serializedResult).not.toContain('/Users/private')
      expect(result.diagnostics).toEqual(expect.arrayContaining([
        { code: 'malformed', count: 2 },
        { code: 'scopeMismatch', count: 1 },
        { code: 'unsafeCandidate', count: 1 },
        { code: 'unsupported', count: 1 },
      ]))

      const selected = result.rows[0]
      if (!selected) throw new Error('Expected a catalog row.')
      await expect(
        fixture.catalog.resolve(scope, selected.selectionToken),
      ).resolves.toMatchObject({
        scope,
        cwd: fixture.cwd,
        sessionId: duplicateId,
        sessionFile: duplicateFile,
      })
      await expect(
        fixture.catalog.resolve(scope, `sel_${'x'.repeat(32)}`),
      ).rejects.toMatchObject({
        code: 'SESSION_CATALOG_SELECTION_STALE',
      } satisfies Partial<OfficialPiSessionCatalogError>)

      await writeFile(duplicateFile, '\n', { flag: 'a' })
      await expect(
        fixture.catalog.resolve(scope, selected.selectionToken),
      ).resolves.toMatchObject({
        scope,
        cwd: fixture.cwd,
        sessionId: duplicateId,
        sessionFile: duplicateFile,
      })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('offers one-shot recovery only for project headers whose cwd is gone', async () => {
    const fixture = await createCatalogFixture()
    const missingFile = join(fixture.sessionDirectory, 'missing-cwd.jsonl')
    const notDirectoryFile = join(fixture.sessionDirectory, 'not-directory-cwd.jsonl')
    const relativeFile = join(fixture.sessionDirectory, 'relative-cwd.jsonl')
    const notDirectory = join(fixture.root, 'not-a-directory')
    try {
      await writeFile(notDirectory, 'fixture', 'utf8')
      await Promise.all([
        writeSession(missingFile, {
          cwd: join(fixture.root, 'moved-away', 'project'),
          id: 'missing-cwd',
        }),
        writeSession(notDirectoryFile, {
          cwd: join(notDirectory, 'project'),
          id: 'not-directory-cwd',
        }),
        writeSession(relativeFile, {
          cwd: 'relative/project',
          id: 'relative-cwd',
        }),
      ])
      await fixture.observations.observe(scope, missingFile)

      const result = await fixture.catalog.list(scope)
      expect(result.rows.map((row) => row.sessionId).sort()).toEqual([
        'missing-cwd',
        'not-directory-cwd',
      ])
      expect(result.diagnostics).toContainEqual({ code: 'scopeMismatch', count: 1 })

      const recoverable = result.rows.find((row) => row.sessionId === 'missing-cwd')
      if (!recoverable) throw new Error('Expected a recoverable session row.')
      await expect(
        fixture.catalog.resolve(scope, recoverable.selectionToken),
      ).resolves.toEqual({
        scope,
        cwd: fixture.cwd,
        sessionId: 'missing-cwd',
        mode: 'recover',
        forkSessionFile: missingFile,
      })
      await expect(
        fixture.catalog.resolve(scope, recoverable.selectionToken),
      ).rejects.toMatchObject({
        code: 'SESSION_CATALOG_SELECTION_STALE',
      } satisfies Partial<OfficialPiSessionCatalogError>)
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('consumes deletion selections once, rejects cross-scope use, and allows append-only growth', async () => {
    const fixture = await createCatalogFixture()
    const sessionFile = join(fixture.sessionDirectory, 'delete-target.jsonl')
    try {
      await writeSession(sessionFile, {
        cwd: fixture.cwd,
        id: 'delete-target',
      })
      await fixture.observations.observe(scope, sessionFile)
      const row = (await fixture.catalog.list(scope)).rows[0]
      if (!row) throw new Error('Expected a deletion target.')

      await expect(fixture.catalog.consumeForDeletion(
        { kind: 'projectless' },
        row.selectionToken,
      )).rejects.toMatchObject({ code: 'SESSION_CATALOG_SELECTION_STALE' })

      const target = await fixture.catalog.consumeForDeletion(
        scope,
        row.selectionToken,
      )
      expect(target).toMatchObject({
        scope,
        cwd: fixture.cwd,
        sessionId: 'delete-target',
        sessionFile,
        selectionMode: 'open',
      })
      await expect(
        fixture.catalog.consumeForDeletion(scope, row.selectionToken),
      ).rejects.toMatchObject({ code: 'SESSION_CATALOG_SELECTION_STALE' })

      await writeFile(sessionFile, `${JSON.stringify({
        type: 'session_info',
        id: randomUUID(),
        parentId: null,
        timestamp: '2026-08-08T00:00:01.000Z',
        name: 'updated during shutdown',
      })}\n`, { flag: 'a' })
      await writeFile(sessionFile, `${JSON.stringify({
        type: 'custom_message',
        id: randomUUID(),
        parentId: null,
        timestamp: '2026-08-08T00:00:02.000Z',
        content: 'x'.repeat(SESSION_CATALOG_MAX_FILE_BYTES),
      })}\n`, { flag: 'a' })
      await expect(fixture.catalog.revalidateDeletionTarget(target))
        .resolves.toBe(sessionFile)
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('deletes a moved-session row as its selected source instead of a fork target', async () => {
    const fixture = await createCatalogFixture()
    const sourceFile = join(fixture.sessionDirectory, 'delete-moved-source.jsonl')
    try {
      await writeSession(sourceFile, {
        cwd: join(fixture.root, 'missing-project'),
        id: 'delete-moved-source',
      })
      await fixture.observations.observe(scope, sourceFile)
      const row = (await fixture.catalog.list(scope)).rows[0]
      if (!row) throw new Error('Expected a moved-session deletion target.')

      await expect(
        fixture.catalog.consumeForDeletion(scope, row.selectionToken),
      ).resolves.toMatchObject({
        scope,
        sessionId: 'delete-moved-source',
        sessionFile: sourceFile,
        selectionMode: 'recover',
      })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects header and inode replacement during deletion revalidation', async () => {
    const fixture = await createCatalogFixture()
    const headerFile = join(fixture.sessionDirectory, 'changed-header.jsonl')
    const inodeFile = join(fixture.sessionDirectory, 'changed-inode.jsonl')
    try {
      await Promise.all([
        writeSession(headerFile, { cwd: fixture.cwd, id: 'changed-header' }),
        writeSession(inodeFile, { cwd: fixture.cwd, id: 'changed-inode' }),
      ])
      await fixture.observations.observe(scope, headerFile)
      const page = await fixture.catalog.list(scope)
      const headerRow = page.rows.find((row) => row.sessionId === 'changed-header')
      const inodeRow = page.rows.find((row) => row.sessionId === 'changed-inode')
      if (!headerRow || !inodeRow) throw new Error('Expected replacement targets.')

      const headerTarget = await fixture.catalog.consumeForDeletion(
        scope,
        headerRow.selectionToken,
      )
      await writeSession(headerFile, { cwd: fixture.cwd, id: 'replacement-header' })
      await expect(fixture.catalog.revalidateDeletionTarget(headerTarget))
        .rejects.toMatchObject({ code: 'SESSION_CATALOG_SELECTION_STALE' })

      const refreshed = await fixture.catalog.list(scope)
      const refreshedInodeRow = refreshed.rows.find(
        (row) => row.sessionId === 'changed-inode',
      )
      if (!refreshedInodeRow) throw new Error('Expected a refreshed inode target.')
      const inodeTarget = await fixture.catalog.consumeForDeletion(
        scope,
        refreshedInodeRow.selectionToken,
      )
      await rm(inodeFile)
      await writeSession(inodeFile, { cwd: fixture.cwd, id: 'changed-inode' })
      await expect(fixture.catalog.revalidateDeletionTarget(inodeTarget))
        .rejects.toMatchObject({ code: 'SESSION_CATALOG_SELECTION_STALE' })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('never recovers a missing header cwd for projectless chat', async () => {
    const fixture = await createCatalogFixture()
    const projectlessScope = { kind: 'projectless' } as const
    const sessionFile = join(fixture.sessionDirectory, 'projectless-moved.jsonl')
    try {
      await fixture.resolver.prepare(projectlessScope)
      await writeSession(sessionFile, {
        cwd: join(fixture.root, 'old-general-chat'),
        id: 'projectless-moved',
      })
      await fixture.observations.observe(projectlessScope, sessionFile)

      await expect(fixture.catalog.list(projectlessScope)).resolves.toMatchObject({
        status: 'ready',
        rows: [],
        diagnostics: [{ code: 'scopeMismatch', count: 1 }],
      })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('replaces a recoverable source row with its current-cwd fork child', async () => {
    const fixture = await createCatalogFixture()
    const sourceFile = join(fixture.sessionDirectory, 'moved-source.jsonl')
    const childFile = join(fixture.sessionDirectory, 'recovered-child.jsonl')
    try {
      await writeSession(sourceFile, {
        cwd: join(fixture.root, 'old-project'),
        id: 'moved-source',
      })
      await writeSession(childFile, {
        cwd: fixture.cwd,
        id: 'recovered-child',
        parentSession: sourceFile,
      })
      await fixture.observations.observe(scope, sourceFile)

      const result = await fixture.catalog.list(scope)
      expect(result.rows.map((row) => row.sessionId)).toEqual(['recovered-child'])
      const child = result.rows[0]
      if (!child) throw new Error('Expected the recovered child row.')
      await expect(fixture.catalog.resolve(scope, child.selectionToken)).resolves.toEqual({
        scope,
        cwd: fixture.cwd,
        sessionId: 'recovered-child',
        mode: 'open',
        sessionFile: childFile,
      })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('paginates deterministically and invalidates stale cursors', async () => {
    const fixture = await createCatalogFixture()
    const files: string[] = []
    try {
      for (let index = 0; index < 51; index += 1) {
        const file = join(fixture.sessionDirectory, `${String(index).padStart(3, '0')}.jsonl`)
        files.push(file)
        await writeSession(file, {
          cwd: fixture.cwd,
          id: `session-${String(index).padStart(3, '0')}`,
          activityAt: Date.UTC(2026, 7, 8, 0, index, 0),
        })
      }
      const observedFile = files[0]
      if (!observedFile) throw new Error('Expected a fixture session.')
      await fixture.observations.observe(scope, observedFile)

      const firstPage = await fixture.catalog.list(scope)
      expect(firstPage.rows).toHaveLength(50)
      expect(firstPage.nextCursor).not.toBeNull()
      const cursor = firstPage.nextCursor
      if (!cursor) throw new Error('Expected a continuation cursor.')
      const secondPage = await fixture.catalog.list(scope, cursor)
      expect(secondPage.rows).toHaveLength(1)
      expect(secondPage.nextCursor).toBeNull()
      const controlInventory = await fixture.catalog.listControlTargets(scope)
      expect(controlInventory.targets).toHaveLength(51)
      expect(controlInventory.targets.every((target) =>
        !('selectionToken' in target) && !('preview' in target))).toBe(true)

      fixture.catalog.invalidate(scope)
      await expect(fixture.catalog.list(scope, cursor)).rejects.toMatchObject({
        code: 'SESSION_CATALOG_CURSOR_STALE',
      } satisfies Partial<OfficialPiSessionCatalogError>)
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('stops after the bounded candidate window', async () => {
    const fixture = await createCatalogFixture()
    const observedFile = join(fixture.sessionDirectory, '000.jsonl')
    try {
      await writeSession(observedFile, { cwd: fixture.cwd, id: 'observed' })
      for (let index = 1; index <= SESSION_CATALOG_MAX_CANDIDATES; index += 1) {
        await writeSession(
          join(fixture.sessionDirectory, `${String(index).padStart(3, '0')}.jsonl`),
          { cwd: fixture.cwd, id: `session-${index}` },
        )
      }
      await fixture.observations.observe(scope, observedFile)

      const result = await fixture.catalog.list(scope)
      expect(result.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'candidateLimit' }),
      ]))
      expect(result.rows).toHaveLength(50)
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('skips a file larger than the per-file metadata limit', async () => {
    const fixture = await createCatalogFixture()
    const observedFile = join(fixture.sessionDirectory, 'observed.jsonl')
    const oversizedFile = join(fixture.sessionDirectory, 'oversized.jsonl')
    try {
      await writeSession(observedFile, { cwd: fixture.cwd, id: 'observed' })
      await writeFile(oversizedFile, '{}\n')
      await truncate(oversizedFile, SESSION_CATALOG_MAX_FILE_BYTES + 1)
      await fixture.observations.observe(scope, observedFile)

      const result = await fixture.catalog.list(scope)
      expect(result.rows).toHaveLength(1)
      expect(result.diagnostics).toContainEqual({ code: 'fileTooLarge', count: 1 })
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('lists a valid session larger than the former 8 MiB limit', async () => {
    const fixture = await createCatalogFixture()
    const sessionFile = join(fixture.sessionDirectory, 'long-running.jsonl')
    try {
      await writeSession(sessionFile, {
        cwd: fixture.cwd,
        id: 'long-running',
        name: 'Long-running session',
      })
      await writeFile(sessionFile, `${JSON.stringify({
        type: 'custom',
        id: randomUUID(),
        parentId: null,
        timestamp: '2026-08-08T00:00:02.000Z',
        customType: 'catalog-padding',
        data: 'x'.repeat(9 * 1_024 * 1_024),
      })}\n`, { flag: 'a' })
      await fixture.observations.observe(scope, sessionFile)

      const result = await fixture.catalog.list(scope)
      expect(result.rows).toEqual([
        expect.objectContaining({
          sessionId: 'long-running',
          name: 'Long-running session',
        }),
      ])
      expect(result.diagnostics).not.toContainEqual(
        expect.objectContaining({ code: 'fileTooLarge' }),
      )
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('hands an exact resolved file to host.replace and confirms official state', async () => {
    const fixture = await createCatalogFixture()
    const sessionFile = join(fixture.sessionDirectory, 'selected.jsonl')
    try {
      await writeSession(sessionFile, { cwd: fixture.cwd, id: 'selected-session' })
      await fixture.observations.observe(scope, sessionFile)
      const page = await fixture.catalog.list(scope)
      const row = page.rows[0]
      if (!row) throw new Error('Expected a selected session.')

      const replacements: unknown[] = []
      let stopped = false
      const state = sessionState('selected-session', sessionFile)
      const snapshot = runtimeSnapshot(fixture.cwd, state)
      const host = activationHost({
        getSnapshot: () => snapshot,
        getState: async () => state,
        replace: async (target) => {
          replacements.push(target)
          return snapshot
        },
        start: async () => snapshot,
        stop: async () => {
          stopped = true
          return { ...snapshot, state: 'stopped' }
        },
      })
      const resolver = new ConversationScopeResolver(
        {
          getLocation: (id) => id === workspaceId
            ? { id, name: 'project', path: fixture.cwd }
            : undefined,
        },
        join(fixture.root, 'general-chat', 'workspace'),
      )
      const activation = new OfficialPiSessionActivationService(
        resolver,
        fixture.observations,
        fixture.catalog,
        host,
      )

      await expect(
        activation.open(scope, row.selectionToken),
      ).resolves.toEqual({
        scope,
        sessionId: 'selected-session',
        generation: 2,
      })
      expect(replacements).toEqual([{
            scope,
        sessionFile,
      }])
      expect(stopped).toBe(false)
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('renames an inactive catalog Session without selecting or replacing it', async () => {
    const fixture = await createCatalogFixture()
    const sessionFile = join(fixture.sessionDirectory, 'rename.jsonl')
    try {
      await writeSession(sessionFile, {
        cwd: fixture.cwd,
        id: 'rename-session',
        name: 'Before',
      })
      await fixture.observations.observe(scope, sessionFile)
      const row = (await fixture.catalog.list(scope)).rows[0]
      if (!row) throw new Error('Expected a session to rename.')

      const state = sessionState('rename-session', sessionFile)
      const snapshot = runtimeSnapshot(fixture.cwd, state)
      const replace = vi.fn(async () => snapshot)
      const start = vi.fn(async () => snapshot)
      const host = activationHost({
        getSnapshot: () => snapshot,
        getState: async () => state,
        replace,
        start,
        stop: async () => ({ ...snapshot, state: 'stopped' }),
      })
      host.renameSession.mockResolvedValueOnce({
        sessionId: 'rename-session',
        name: 'After',
      })
      const activation = new OfficialPiSessionActivationService(
        fixture.resolver,
        fixture.observations,
        fixture.catalog,
        host,
      )

      await expect(
        activation.rename(scope, row.selectionToken, 'After'),
      ).resolves.toEqual({
        scope,
        sessionId: 'rename-session',
        name: 'After',
      })
      expect(host.renameSession).toHaveBeenCalledWith(
        scope,
        sessionFile,
        'After',
      )
      expect(replace).not.toHaveBeenCalled()
      expect(start).not.toHaveBeenCalled()
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('recovers a moved project session through one official fork and confirms the child', async () => {
    const fixture = await createCatalogFixture()
    const sourceFile = join(fixture.sessionDirectory, 'moved-source.jsonl')
    const childFile = join(fixture.sessionDirectory, 'recovered-child.jsonl')
    try {
      await writeSession(sourceFile, {
        cwd: join(fixture.root, 'old-project'),
        id: 'moved-source',
        preview: 'history from the moved project',
      })
      const sourceBefore = await readFile(sourceFile, 'utf8')
      await fixture.observations.observe(scope, sourceFile)
      const row = (await fixture.catalog.list(scope)).rows[0]
      if (!row) throw new Error('Expected a recoverable session.')

      const replacements: unknown[] = []
      const childState = sessionState('recovered-child', childFile)
      let snapshot = runtimeSnapshot(fixture.cwd, childState)
      const host = activationHost({
        getSnapshot: () => snapshot,
        getState: async () => childState,
        replace: async (target) => {
          replacements.push(target)
          await writeSession(childFile, {
            cwd: fixture.cwd,
            id: 'recovered-child',
            parentSession: sourceFile,
            preview: 'history from the moved project',
          })
          snapshot = runtimeSnapshot(fixture.cwd, childState)
          return snapshot
        },
        start: async () => snapshot,
        stop: async () => ({ ...snapshot, state: 'stopped' }),
      })
      const activation = new OfficialPiSessionActivationService(
        fixture.resolver,
        fixture.observations,
        fixture.catalog,
        host,
      )

      await expect(
        activation.open(scope, row.selectionToken),
      ).resolves.toEqual({
        scope,
        sessionId: 'recovered-child',
        generation: 2,
      })
      expect(replacements).toEqual([{
            scope,
        forkSessionFile: sourceFile,
      }])
      expect(await readFile(sourceFile, 'utf8')).toBe(sourceBefore)
      expect((await fixture.catalog.list(scope)).rows.map((item) => item.sessionId))
        .toEqual(['recovered-child'])
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('consumes a recoverable token before a failed fork can be queued twice', async () => {
    const fixture = await createCatalogFixture()
    const sourceFile = join(fixture.sessionDirectory, 'moved-source.jsonl')
    try {
      await writeSession(sourceFile, {
        cwd: join(fixture.root, 'old-project'),
        id: 'moved-source',
      })
      await fixture.observations.observe(scope, sourceFile)
      const row = (await fixture.catalog.list(scope)).rows[0]
      if (!row) throw new Error('Expected a recoverable session.')

      const state = sessionState('unused', undefined)
      const snapshot = runtimeSnapshot(fixture.cwd, state)
      const replacements: unknown[] = []
      const host = activationHost({
        getSnapshot: () => snapshot,
        getState: async () => state,
        replace: async (target) => {
          replacements.push(target)
          throw new Error('fixture fork failed after launch')
        },
        start: async () => snapshot,
        stop: async () => ({ ...snapshot, state: 'stopped' }),
      })
      const activation = new OfficialPiSessionActivationService(
        fixture.resolver,
        fixture.observations,
        fixture.catalog,
        host,
      )

      const results = await Promise.allSettled([
        activation.open(scope, row.selectionToken),
        activation.open(scope, row.selectionToken),
      ])
      expect(results[0]).toMatchObject({
        status: 'rejected',
        reason: { code: 'PI_SESSION_CONFIRMATION_FAILED' },
      })
      expect(results[1]).toMatchObject({
        status: 'rejected',
        reason: { code: 'SESSION_CATALOG_SELECTION_STALE' },
      })
      expect(replacements).toHaveLength(1)

      const refreshed = await fixture.catalog.list(scope)
      expect(refreshed.rows[0]?.selectionToken).not.toBe(row.selectionToken)
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects a recovered child whose parent header does not match the source', async () => {
    const fixture = await createCatalogFixture()
    const sourceFile = join(fixture.sessionDirectory, 'moved-source.jsonl')
    const childFile = join(fixture.sessionDirectory, 'wrong-child.jsonl')
    const wrongParent = join(fixture.sessionDirectory, 'wrong-parent.jsonl')
    try {
      await Promise.all([
        writeSession(sourceFile, {
          cwd: join(fixture.root, 'old-project'),
          id: 'moved-source',
        }),
        writeSession(wrongParent, {
          cwd: fixture.cwd,
          id: 'wrong-parent',
        }),
      ])
      await fixture.observations.observe(scope, sourceFile)
      const row = (await fixture.catalog.list(scope)).rows
        .find((item) => item.sessionId === 'moved-source')
      if (!row) throw new Error('Expected a recoverable session.')

      const state = sessionState('wrong-child', childFile)
      const snapshot = runtimeSnapshot(fixture.cwd, state)
      let stopped = false
      const host = activationHost({
        getSnapshot: () => snapshot,
        getState: async () => state,
        replace: async () => {
          await writeSession(childFile, {
            cwd: fixture.cwd,
            id: 'wrong-child',
            parentSession: wrongParent,
          })
          return snapshot
        },
        start: async () => snapshot,
        stop: async () => {
          stopped = true
          return { ...snapshot, state: 'stopped' }
        },
      })
      const activation = new OfficialPiSessionActivationService(
        fixture.resolver,
        fixture.observations,
        fixture.catalog,
        host,
      )

      await expect(
        activation.open(scope, row.selectionToken),
      ).rejects.toMatchObject({ code: 'PI_SESSION_CONFIRMATION_FAILED' })
      expect(stopped).toBe(false)
      expect(host.rollbackSelection).toHaveBeenCalledOnce()
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('stops a replacement that reports a different official session', async () => {
    const fixture = await createCatalogFixture()
    const sessionFile = join(fixture.sessionDirectory, 'selected.jsonl')
    try {
      await writeSession(sessionFile, { cwd: fixture.cwd, id: 'selected-session' })
      await fixture.observations.observe(scope, sessionFile)

      const wrongState = sessionState('different-session', sessionFile)
      const snapshot = runtimeSnapshot(fixture.cwd, wrongState)
      let stopped = false
      const host = activationHost({
        getSnapshot: () => snapshot,
        getState: async () => wrongState,
        replace: async () => snapshot,
        start: async () => snapshot,
        stop: async () => {
          stopped = true
          return { ...snapshot, state: 'stopped' }
        },
      })
      const resolver = new ConversationScopeResolver(
        {
          getLocation: (id) => id === workspaceId
            ? { id, name: 'project', path: fixture.cwd }
            : undefined,
        },
        join(fixture.root, 'general-chat', 'workspace'),
      )
      const activation = new OfficialPiSessionActivationService(
        resolver,
        fixture.observations,
        fixture.catalog,
        host,
      )
      await activation.start(scope)
      expect(activation.getActiveScope()).toEqual(scope)
      const row = (await fixture.catalog.list(scope)).rows[0]
      if (!row) throw new Error('Expected a selected session.')

      await expect(
        activation.open(scope, row.selectionToken),
      ).rejects.toMatchObject({
        code: 'PI_SESSION_CONFIRMATION_FAILED',
      } satisfies Partial<OfficialPiSessionActivationError>)
      expect(stopped).toBe(false)
      expect(host.rollbackSelection).toHaveBeenCalledOnce()
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('learns a newly available session file after agent_settled', async () => {
    const fixture = await createCatalogFixture()
    const sessionFile = join(fixture.sessionDirectory, 'settled.jsonl')
    try {
      let state = sessionState('settled-session', undefined)
      let snapshot = runtimeSnapshot(fixture.cwd, state)
      const host = activationHost({
        getSnapshot: () => snapshot,
        getState: async () => state,
        replace: async () => snapshot,
        start: async () => snapshot,
        stop: async () => ({ ...snapshot, state: 'stopped' }),
      })
      const resolver = new ConversationScopeResolver(
        {
          getLocation: (id) => id === workspaceId
            ? { id, name: 'project', path: fixture.cwd }
            : undefined,
        },
        join(fixture.root, 'general-chat', 'workspace'),
      )
      const activation = new OfficialPiSessionActivationService(
        resolver,
        fixture.observations,
        fixture.catalog,
        host,
      )

      await activation.start(scope)
      expect(fixture.observations.getState(scope).status).toBe(
        'activationUnavailable',
      )

      await writeSession(sessionFile, {
        cwd: fixture.cwd,
        id: 'settled-session',
      })
      state = sessionState('settled-session', sessionFile)
      snapshot = runtimeSnapshot(fixture.cwd, state)
      await activation.onAgentSettled('rt-test', snapshot.generation)

      expect(fixture.observations.get(scope)?.directory).toBe(
        fixture.sessionDirectory,
      )
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('preserves the last observation when command state refresh races replacement', async () => {
    const fixture = await createCatalogFixture()
    const sessionFile = join(fixture.sessionDirectory, 'active.jsonl')
    try {
      await writeSession(sessionFile, { cwd: fixture.cwd, id: 'active-session' })
      const state = sessionState('active-session', sessionFile)
      const snapshot = runtimeSnapshot(fixture.cwd, state)
      let getStateCalls = 0
      const host = activationHost({
        getSnapshot: () => snapshot,
        getState: async () => {
          getStateCalls += 1
          throw new Error('replacement started')
        },
        replace: async () => snapshot,
        start: async () => snapshot,
        stop: async () => ({ ...snapshot, state: 'stopped' }),
      })
      const resolver = new ConversationScopeResolver(
        {
          getLocation: (id) => id === workspaceId
            ? { id, name: 'project', path: fixture.cwd }
            : undefined,
        },
        join(fixture.root, 'general-chat', 'workspace'),
      )
      const activation = new OfficialPiSessionActivationService(
        resolver,
        fixture.observations,
        fixture.catalog,
        host,
      )

      await activation.start(scope)
      const invalidate = vi.spyOn(fixture.catalog, 'invalidate')
      invalidate.mockClear()
      activation.onSessionCatalogChanged('rt-test', snapshot.generation + 1)
      expect(invalidate).not.toHaveBeenCalled()
      activation.onSessionCatalogChanged('rt-test', snapshot.generation)
      expect(invalidate).toHaveBeenCalledWith(scope)
      await activation.afterSuccessfulCommand(
        'set_session_name',
        runtimeIdentity(host, snapshot.generation + 1),
        runtimeIdentity(host, snapshot.generation + 1),
      )
      expect(getStateCalls).toBe(0)
      await activation.afterSuccessfulCommand(
        'set_session_name',
        runtimeIdentity(host),
        runtimeIdentity(host),
      )
      expect(getStateCalls).toBe(1)
      await expect(activation.afterSuccessfulCommand(
        'fork',
        runtimeIdentity(host),
        runtimeIdentity(host),
      )).rejects.toMatchObject({
        code: 'PI_SESSION_CONFIRMATION_FAILED',
      })
      expect(getStateCalls).toBe(2)

      expect(fixture.observations.get(scope)?.directory).toBe(
        fixture.sessionDirectory,
      )
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('keeps the active scope aligned with a successful session generation change', async () => {
    const fixture = await createCatalogFixture()
    const firstFile = join(fixture.sessionDirectory, 'first.jsonl')
    const secondFile = join(fixture.sessionDirectory, 'second.jsonl')
    try {
      await writeSession(firstFile, { cwd: fixture.cwd, id: 'first-session' })
      await writeSession(secondFile, { cwd: fixture.cwd, id: 'second-session' })
      let state = sessionState('first-session', firstFile)
      let snapshot = runtimeSnapshot(fixture.cwd, state)
      const host = activationHost({
        getSnapshot: () => snapshot,
        getState: async () => state,
        replace: async () => snapshot,
        start: async () => snapshot,
        stop: async () => ({ ...snapshot, state: 'stopped' }),
      })
      const resolver = new ConversationScopeResolver(
        {
          getLocation: (id) => id === workspaceId
            ? { id, name: 'project', path: fixture.cwd }
            : undefined,
        },
        join(fixture.root, 'general-chat', 'workspace'),
      )
      const activation = new OfficialPiSessionActivationService(
        resolver,
        fixture.observations,
        fixture.catalog,
        host,
      )

      await activation.start(scope)
      const sourceGeneration = snapshot.generation
      state = sessionState('second-session', secondFile)
      snapshot = {
        ...runtimeSnapshot(fixture.cwd, state),
        generation: sourceGeneration + 1,
      }

      await activation.afterSuccessfulCommand(
        'new_session',
        runtimeIdentity(host, sourceGeneration),
        runtimeIdentity(host),
      )

      expect(activation.getActiveScope()).toEqual(scope)
      const invalidate = vi.spyOn(fixture.catalog, 'invalidate')
      invalidate.mockClear()
      activation.onSessionCatalogChanged('rt-test', snapshot.generation)
      expect(invalidate).toHaveBeenCalledWith(scope)
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })
})
