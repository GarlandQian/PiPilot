import { lstat, mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OfficialPiSessionDeletionService,
} from '../../src/main/conversations/official-pi-session-deletion-service'
import type {
  ResolvedOfficialPiSessionDeletionTarget,
} from '../../src/main/conversations/official-pi-session-catalog'
import type { ConversationScope } from '../../src/shared/conversation-scope'
import type { LocalPiRuntimeSnapshot } from '../../src/shared/local-pi'

const scope: ConversationScope = {
  kind: 'project',
  workspaceId: '00000000-0000-4000-8000-000000000301',
}
const token = `sel_${'d'.repeat(32)}`
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

async function createTarget(name = 'selected.jsonl') {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'pipilot-delete-')))
  temporaryDirectories.push(directory)
  const sessionFile = join(directory, name)
  await writeFile(sessionFile, '{"type":"session"}\n')
  const details = await lstat(sessionFile)
  const target: ResolvedOfficialPiSessionDeletionTarget = {
    scope,
    cwd: directory,
    sessionId: 'duplicate-session-id',
    sessionFile,
    root: dirname(sessionFile),
    selectionMode: 'open',
    headerIdentity: 'header-identity',
    identity: {
      dev: Number(details.dev),
      ino: Number(details.ino),
    },
  }
  return { directory, sessionFile, target }
}

function runtimeSnapshot(
  sessionFile: string | null,
  state: LocalPiRuntimeSnapshot['state'] = 'ready',
): LocalPiRuntimeSnapshot {
  return {
    state,
    generation: 4,
    cwd: state === 'stopped' ? null : dirname(sessionFile ?? '/private/runtime'),
    sessionFile: state === 'stopped' ? null : sessionFile,
    sessionState: null,
    commands: [],
    stderr: '',
    diagnostics: [],
  }
}

describe('OfficialPiSessionDeletionService', () => {
  it('stops an exact active target before revalidation and reports trash', async () => {
    const fixture = await createTarget()
    const order: string[] = []
    let snapshot = runtimeSnapshot(fixture.sessionFile)
    const stop = vi.fn(async () => {
      order.push('stop')
      snapshot = runtimeSnapshot(null, 'stopped')
      return snapshot
    })
    const revalidateDeletionTarget = vi.fn(async () => {
      order.push('revalidate')
      return fixture.sessionFile
    })
    const fallbackUnlink = vi.fn(async () => undefined)
    const service = new OfficialPiSessionDeletionService({
      activationService: { stop },
      catalog: {
        consumeForDeletion: vi.fn(async () => fixture.target),
        invalidate: vi.fn(),
        revalidateDeletionTarget,
      },
      runtimeHost: {
        isActiveSession: () => true,
        releaseSession: vi.fn(async () => false),
      },
      trashItem: async (path) => {
        order.push('trash')
        await unlink(path)
      },
      unlink: fallbackUnlink,
    })

    await expect(service.delete(scope, token)).resolves.toEqual({
      scope,
      sessionId: 'duplicate-session-id',
      activeDeleted: true,
      disposition: 'trash',
    })
    expect(order).toEqual(['stop', 'revalidate', 'trash'])
    expect(fallbackUnlink).not.toHaveBeenCalled()
    await expect(lstat(fixture.sessionFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not stop a runtime that only shares the session ID or file scope separately', async () => {
    const fixture = await createTarget()
    const otherFile = join(fixture.directory, 'other.jsonl')
    await writeFile(otherFile, '{"type":"session"}\n')
    const stop = vi.fn(async () => runtimeSnapshot(null, 'stopped'))
    const trashItem = vi.fn(async (path: string) => unlink(path))
    const catalog = {
      consumeForDeletion: vi.fn(async () => fixture.target),
      invalidate: vi.fn(),
      revalidateDeletionTarget: vi.fn(async () => fixture.sessionFile),
    }

    const wrongFileService = new OfficialPiSessionDeletionService({
      activationService: { stop },
      catalog,
      runtimeHost: {
        isActiveSession: () => false,
        releaseSession: vi.fn(async () => false),
      },
      trashItem,
    })
    await expect(wrongFileService.delete(scope, token)).resolves.toMatchObject({
      activeDeleted: false,
    })
    expect(stop).not.toHaveBeenCalled()
    await expect(lstat(otherFile)).resolves.toBeTruthy()

    const second = await createTarget('scope-mismatch.jsonl')
    const wrongScopeService = new OfficialPiSessionDeletionService({
      activationService: { stop },
      catalog: {
        consumeForDeletion: vi.fn(async () => second.target),
        invalidate: vi.fn(),
        revalidateDeletionTarget: vi.fn(async () => second.sessionFile),
      },
      runtimeHost: {
        isActiveSession: () => false,
        releaseSession: vi.fn(async () => false),
      },
      trashItem: async (path) => unlink(path),
    })
    await expect(wrongScopeService.delete(scope, token)).resolves.toMatchObject({
      activeDeleted: false,
    })
    expect(stop).not.toHaveBeenCalled()
  })

  it('revalidates a surviving trash target before permanent unlink fallback', async () => {
    const fixture = await createTarget()
    const revalidateDeletionTarget = vi.fn(async () => fixture.sessionFile)
    const fallbackUnlink = vi.fn(async (path: string) => unlink(path))
    const service = new OfficialPiSessionDeletionService({
      activationService: {
        stop: vi.fn(async () => runtimeSnapshot(null, 'stopped')),
      },
      catalog: {
        consumeForDeletion: vi.fn(async () => fixture.target),
        invalidate: vi.fn(),
        revalidateDeletionTarget,
      },
      runtimeHost: {
        isActiveSession: () => false,
        releaseSession: vi.fn(async () => false),
      },
      trashItem: vi.fn(async () => undefined),
      unlink: fallbackUnlink,
    })

    await expect(service.delete(scope, token)).resolves.toMatchObject({
      activeDeleted: false,
      disposition: 'unlink',
    })
    expect(revalidateDeletionTarget).toHaveBeenCalledTimes(2)
    expect(fallbackUnlink).toHaveBeenCalledWith(fixture.sessionFile)
  })

  it('returns a typed failure when active deletion stops but trash and unlink fail', async () => {
    const fixture = await createTarget()
    const stop = vi.fn(async () => runtimeSnapshot(null, 'stopped'))
    const invalidate = vi.fn()
    const service = new OfficialPiSessionDeletionService({
      activationService: { stop },
      catalog: {
        consumeForDeletion: vi.fn(async () => fixture.target),
        invalidate,
        revalidateDeletionTarget: vi.fn(async () => fixture.sessionFile),
      },
      runtimeHost: {
        isActiveSession: () => true,
        releaseSession: vi.fn(async () => false),
      },
      trashItem: vi.fn(async () => {
        throw new Error('trash unavailable')
      }),
      unlink: vi.fn(async () => {
        throw new Error('unlink denied')
      }),
    })

    await expect(service.delete(scope, token)).rejects.toMatchObject({
      code: 'SESSION_DELETE_FAILED',
      message: 'The selected session could not be deleted.',
    })
    expect(stop).toHaveBeenCalledOnce()
    expect(invalidate).toHaveBeenCalledWith(scope)
    await expect(lstat(fixture.sessionFile)).resolves.toBeTruthy()
  })

  it('does not attempt filesystem mutation when the active runtime cannot stop', async () => {
    const fixture = await createTarget()
    const trashItem = vi.fn(async () => undefined)
    const service = new OfficialPiSessionDeletionService({
      activationService: {
        stop: vi.fn(async () => {
          throw new Error('bounded stop failed')
        }),
      },
      catalog: {
        consumeForDeletion: vi.fn(async () => fixture.target),
        invalidate: vi.fn(),
        revalidateDeletionTarget: vi.fn(async () => fixture.sessionFile),
      },
      runtimeHost: {
        isActiveSession: () => true,
        releaseSession: vi.fn(async () => false),
      },
      trashItem,
    })

    await expect(service.delete(scope, token)).rejects.toMatchObject({
      code: 'SESSION_DELETE_FAILED',
    })
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('releases an inactive cached runtime before mutating its session file', async () => {
    const fixture = await createTarget()
    const order: string[] = []
    const releaseSession = vi.fn(async (sessionFile: string) => {
      order.push(`release:${sessionFile}`)
      return true
    })
    const service = new OfficialPiSessionDeletionService({
      activationService: {
        stop: vi.fn(async () => runtimeSnapshot(null, 'stopped')),
      },
      catalog: {
        consumeForDeletion: vi.fn(async () => fixture.target),
        invalidate: vi.fn(),
        revalidateDeletionTarget: vi.fn(async () => {
          order.push('revalidate')
          return fixture.sessionFile
        }),
      },
      runtimeHost: {
        isActiveSession: () => false,
        releaseSession,
      },
      trashItem: async (path) => {
        order.push('trash')
        await unlink(path)
      },
    })

    await expect(service.delete(scope, token)).resolves.toMatchObject({
      activeDeleted: false,
      disposition: 'trash',
    })
    expect(releaseSession).toHaveBeenCalledWith(fixture.sessionFile)
    expect(order).toEqual([
      `release:${fixture.sessionFile}`,
      'revalidate',
      'trash',
    ])
  })
})
