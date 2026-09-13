import { describe, expect, it, vi } from 'vitest'
import { INSPECTOR_MAX_OPEN_FILES, InspectorResourcesController } from '../../src/components/inspector/inspector-resources'
import type { WorkspaceFilePreview } from '../../src/shared/workspace-content'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222'

function preview(path: string, content = path): WorkspaceFilePreview {
  return { workspaceId, path, content, size: content.length, kind: 'text', fingerprint: 'a'.repeat(64) }
}

function deferred() {
  let resolve!: (value: WorkspaceFilePreview) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<WorkspaceFilePreview>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

describe('inspector workspace resources', () => {
  it('retains independent previews through tree navigation and selects a neighbor on close', async () => {
    const read = vi.fn(async (path: string) => preview(path))
    const controller = new InspectorResourcesController(workspaceId, read)
    controller.setSession('session-a')
    controller.open('src/a.ts')
    await settle()
    controller.showTree()
    expect(controller.getSnapshot().activePath).toBeNull()
    controller.open('src/b.ts')
    await settle()
    controller.open('src/a.ts')
    expect(read).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().files.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts'])
    controller.close('src/b.ts')
    expect(controller.getSnapshot().activePath).toBe('src/a.ts')
    controller.open('src/b.ts')
    await settle()
    controller.close('src/b.ts')
    expect(controller.getSnapshot().activePath).toBe('src/a.ts')
    controller.close('src/a.ts')
    expect(controller.getSnapshot()).toEqual({ files: [], activePath: null, atCapacity: false })
  })

  it('settles out-of-order reads without changing the selected file', async () => {
    const a = deferred()
    const b = deferred()
    const controller = new InspectorResourcesController(workspaceId, (path) => path === 'a.ts' ? a.promise : b.promise)
    controller.setSession('a')
    controller.open('a.ts')
    controller.open('b.ts')
    await settle()
    b.resolve(preview('b.ts'))
    await settle()
    a.resolve(preview('a.ts'))
    await settle()
    expect(controller.getSnapshot().activePath).toBe('b.ts')
    expect(controller.getSnapshot().files.map((file) => file.phase)).toEqual(['ready', 'ready'])
  })

  it('reloads a cached file while preserving its previous preview until the fresh read succeeds', async () => {
    const reload = deferred()
    const original = preview('a.ts', 'original disk content')
    const read = vi.fn().mockResolvedValueOnce(original).mockReturnValueOnce(reload.promise)
    const controller = new InspectorResourcesController(workspaceId, read)
    controller.setSession('a')
    controller.open('a.ts')
    await settle()
    controller.showTree()
    controller.open('a.ts')
    expect(read).toHaveBeenCalledTimes(1)
    controller.open('a.ts', true)
    await settle()
    expect(read).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().files[0]).toMatchObject({ phase: 'loading', preview: original })
    reload.resolve(preview('a.ts', 'changed on disk'))
    await settle()
    expect(controller.getSnapshot().files[0]).toMatchObject({ phase: 'ready', preview: { content: 'changed on disk' } })
    expect(controller.getSnapshot().activePath).toBe('a.ts')
  })

  it('ignores a superseded reload and retains the last good preview with an explicit error on failure', async () => {
    const superseded = deferred()
    const failed = deferred()
    const retry = deferred()
    const original = preview('a.ts', 'last good content')
    const read = vi.fn().mockResolvedValueOnce(original)
      .mockReturnValueOnce(superseded.promise).mockReturnValueOnce(failed.promise).mockReturnValueOnce(retry.promise)
    const controller = new InspectorResourcesController(workspaceId, read)
    controller.setSession('a')
    controller.open('a.ts')
    await settle()
    controller.open('a.ts', true)
    await settle()
    controller.open('a.ts', true)
    await settle()
    superseded.resolve(preview('a.ts', 'superseded content'))
    await settle()
    expect(controller.getSnapshot().files[0]).toMatchObject({ phase: 'loading', preview: original })
    failed.reject({ code: 'WORKSPACE_PATH_NOT_FOUND' })
    await settle()
    expect(controller.getSnapshot().files[0]).toMatchObject({ phase: 'error', errorCode: 'WORKSPACE_PATH_NOT_FOUND', preview: original })
    controller.open('a.ts', true)
    await settle()
    expect(controller.getSnapshot().files[0].errorCode).toBeUndefined()
    retry.resolve(preview('a.ts', 'restored file'))
    await settle()
    expect(controller.getSnapshot().files[0]).toMatchObject({ phase: 'ready', preview: { content: 'restored file' } })
  })

  it('ignores a closed request even when that path has been reopened', async () => {
    const old = deferred()
    const current = deferred()
    const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const controller = new InspectorResourcesController(workspaceId, read)
    controller.setSession('a')
    controller.open('a.ts')
    await settle()
    controller.close('a.ts')
    controller.open('a.ts')
    await settle()
    old.resolve(preview('a.ts', 'old'))
    await settle()
    expect(controller.getSnapshot().files[0].phase).toBe('loading')
    expect(controller.getSnapshot().files[0].preview).toBeUndefined()
    current.resolve(preview('a.ts', 'current'))
    await settle()
    expect(controller.getSnapshot().files[0].preview).toMatchObject({ content: 'current' })
  })

  it.each(['success', 'failure'] as const)('blocks stale %s across a session transition and resumes unfinished previews', async (outcome) => {
    const old = deferred()
    const current = deferred()
    const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const controller = new InspectorResourcesController(workspaceId, read)
    controller.setSession('a')
    controller.open('a.ts')
    await settle()
    controller.setSession(null)
    expect(controller.open('blocked.ts')).toBe(false)
    if (outcome === 'success') old.resolve(preview('a.ts', 'stale'))
    else old.reject({ code: 'STALE_FAILURE' })
    await settle()
    expect(controller.getSnapshot().files[0].phase).toBe('loading')
    controller.setSession('b')
    await settle()
    current.resolve(preview('a.ts', 'new session'))
    await settle()
    expect(controller.getSnapshot().files[0]).toMatchObject({ sessionKey: 'b', phase: 'ready', preview: { content: 'new session' } })
  })

  it('keeps ready workspace previews across sessions and drops reads after disposal', async () => {
    const pending = deferred()
    const read = vi.fn().mockResolvedValueOnce(preview('a.ts')).mockReturnValueOnce(pending.promise)
    const controller = new InspectorResourcesController(workspaceId, read)
    controller.setSession('a')
    controller.open('a.ts')
    await settle()
    controller.setSession('b')
    controller.open('a.ts')
    expect(read).toHaveBeenCalledTimes(1)
    controller.open('pending.ts')
    await settle()
    controller.dispose()
    pending.resolve(preview('pending.ts'))
    await settle()
    expect(controller.getSnapshot().files[1].phase).toBe('loading')
    expect(controller.open('new.ts')).toBe(false)
  })

  it.each(['workspace', 'path'] as const)('rejects a preview with a mismatched %s owner', async (mismatch) => {
    const result = mismatch === 'workspace' ? { ...preview('a.ts'), workspaceId: otherWorkspaceId } : preview('other.ts')
    const controller = new InspectorResourcesController(workspaceId, async () => result)
    controller.setSession('a')
    controller.open('a.ts')
    await settle()
    expect(controller.getSnapshot().files[0]).toMatchObject({ phase: 'error', errorCode: 'WORKSPACE_CONTENT_STALE_WORKSPACE' })
    expect(controller.getSnapshot().files[0].preview).toBeUndefined()
  })

  it('only restores a canonical path and matching workspace-owned preview', () => {
    const read = vi.fn()
    const restored = { workspaceId, sessionKey: 'a', path: 'a.ts', phase: 'ready' as const, preview: preview('a.ts') }
    expect(new InspectorResourcesController(workspaceId, read, restored).getSnapshot().activePath).toBe('a.ts')
    for (const invalid of [
      { ...restored, workspaceId: otherWorkspaceId },
      { ...restored, path: '../a.ts' },
      { ...restored, preview: preview('b.ts') },
      { ...restored, preview: { ...preview('a.ts'), workspaceId: otherWorkspaceId } },
    ]) expect(new InspectorResourcesController(workspaceId, read, invalid).getSnapshot().files).toEqual([])
    const controller = new InspectorResourcesController(workspaceId, read)
    controller.setSession('a')
    for (const path of ['.', '../secret', '/private/secret', 'C:\\secret', 'a/../secret']) expect(controller.open(path)).toBe(false)
    expect(read).not.toHaveBeenCalled()
  })

  it('evicts the least recently selected completed file while preserving the active and loading files', async () => {
    const pending = deferred()
    const read = vi.fn((path: string) => path === 'loading.ts' ? pending.promise : Promise.resolve(preview(path)))
    const controller = new InspectorResourcesController(workspaceId, read)
    controller.setSession('a')
    controller.open('loading.ts')
    for (let index = 1; index < INSPECTOR_MAX_OPEN_FILES; index += 1) controller.open(`${index}.ts`)
    await settle()
    controller.open('1.ts')
    controller.open('extra.ts')
    await settle()
    expect(controller.getSnapshot().files).toHaveLength(INSPECTOR_MAX_OPEN_FILES)
    const paths = controller.getSnapshot().files.map((file) => file.path)
    expect(paths).toContain('loading.ts')
    expect(paths).toContain('1.ts')
    expect(paths).not.toContain('2.ts')
    expect(controller.getSnapshot().activePath).toBe('extra.ts')
  })

  it('refuses a ninth unfinished file until one closes instead of evicting pending reads', async () => {
    const pending = deferred()
    const read = vi.fn(() => pending.promise)
    const controller = new InspectorResourcesController(workspaceId, read)
    controller.setSession('a')
    for (let index = 0; index < INSPECTOR_MAX_OPEN_FILES; index += 1) controller.open(`${index}.ts`)
    await settle()
    expect(controller.open('extra.ts')).toBe(false)
    expect(controller.getSnapshot().atCapacity).toBe(true)
    expect(controller.getSnapshot().activePath).toBe('7.ts')
    expect(read).toHaveBeenCalledTimes(INSPECTOR_MAX_OPEN_FILES)
    controller.close('0.ts')
    expect(controller.open('extra.ts')).toBe(true)
    expect(controller.getSnapshot().atCapacity).toBe(false)
  })
})
