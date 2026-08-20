import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LocalPiIntegrationService,
  type LocalPiIntegrationError,
} from '../../src/main/local-pi-management/local-pi-integration-service'
import type { LocalPiManagementHost } from '../../src/main/local-pi-management/local-pi-management-host'
import type { PiManagementSnapshotPayload } from '../../src/shared/pi-integrations'

const workspaceId = '00000000-0000-4000-8000-000000000222'
const roots: string[] = []


function payload(
  source?: string,
  retry: { globalEnabled: boolean; effectiveEnabled: boolean } = {
    globalEnabled: true,
    effectiveEnabled: true,
  },
): PiManagementSnapshotPayload {
  return {
    packages: source
      ? [{
          id: 'fixture-package',
          source,
          sourceType: 'npm',
          displayName: 'Fixture package',
          scope: 'project',
          pinned: false,
          filtered: false,
          resourceCounts: { extension: 0, skill: 0, prompt: 0, theme: 0 },
          compatibility: 'not-observed',
          updateAvailable: false,
        }]
      : [],
    resources: [],
    updates: [],
    retry: {
      globalEnabled: retry.globalEnabled,
      effective: {
        enabled: retry.effectiveEnabled,
        maxRetries: 3,
        baseDelayMs: 1000,
      },
    },
    diagnostics: [],
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-integrations-service-'))
  roots.push(root)
  const projectCwd = join(root, 'project')
  const projectlessCwd = join(root, 'projectless')
      let activeScope: { kind: 'project'; workspaceId: string } | { kind: 'projectless' } = { kind: 'project', workspaceId }
  const commands: Array<Record<string, unknown>> = []
  const helperRun = vi.fn(async (command: Record<string, unknown>, onProgress?: (value: unknown) => void) => {
    commands.push(command)
    if (command.action === 'install') {
      onProgress?.({ type: 'progress', action: 'install', source: command.source, message: 'Installing' })
    }
    return payload(
      typeof command.source === 'string' ? command.source : undefined,
      typeof command.enabled === 'boolean'
        ? { globalEnabled: command.enabled, effectiveEnabled: command.enabled }
        : undefined,
    )
  })
  const helperHost = {
    run: helperRun,
    dispose: vi.fn(async () => undefined),
  } as unknown as LocalPiManagementHost
  let runtimeSnapshot = {
    state: 'ready',
    generation: 11,
    cwd: projectCwd,
  }
  const runtimeHost = {
    getSnapshot: vi.fn(() => runtimeSnapshot),
    request: vi.fn(async (): Promise<{ success: boolean; error?: string }> => ({ success: true })),
    restart: vi.fn(async () => ({ state: 'ready' })),
  }
  const restartHosts = vi.fn(async () => undefined)
  const reloadHosts = vi.fn(async () => undefined)
  let id = 300
  const service = new LocalPiIntegrationService({
    getActiveScope: () => activeScope,
    helperHost,
    managedPackageStatePath: join(root, 'state', 'pi-managed-packages.json'),
    restartMarkerPath: join(root, 'state', 'pi-integrations.json'),
    runtimeHost: runtimeHost as never,
    reloadHosts,
    restartHosts,
    scopeResolver: {
      prepare: vi.fn(async () => ({ scope: { kind: 'projectless' }, cwd: projectlessCwd })),
      resolve: vi.fn(async () => ({ scope: activeScope, cwd: projectCwd })),
    } as never,
    createId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
    now: () => 1000,
  })
  return {
    commands,
    helperRun,
    runtimeHost,
    reloadHosts,
    restartHosts,
    service,
    managedPackageStatePath: join(root, 'state', 'pi-managed-packages.json'),
    restartMarkerPath: join(root, 'state', 'pi-integrations.json'),
    setScope(scope: typeof activeScope) {
      activeScope = scope
    },
    setRuntime(snapshot: typeof runtimeSnapshot) {
      runtimeSnapshot = snapshot
    },
  }
}

describe('LocalPiIntegrationService', () => {
  it('reports a bundled-SDK snapshot without touching the runtime', async () => {
    const { runtimeHost, service } = await fixture()
    try {
        await expect(service.load({ kind: 'global' })).resolves.toMatchObject({
          state: 'ready',
          executable: { path: 'bundled', version: '0.84.2' },
        packages: [],
      })
      expect(runtimeHost.restart).not.toHaveBeenCalled()
    } finally {
      await service.dispose()
    }
  })

  it('uses exact global/project cwd and reloads affected runtimes before restart', async () => {
    const { commands, reloadHosts, restartHosts, restartMarkerPath, runtimeHost, service } = await fixture()
    const events: string[] = []
    const unsubscribe = service.subscribe((operation) => events.push(`${operation.kind}:${operation.phase}`))
    try {
      await service.load({ kind: 'global' })
      const installed = await service.install(
        { kind: 'project', workspaceId },
        'npm:project-fixture',
      )
      expect(installed.snapshot.restartRequired).toBe(false)
      expect(installed.runtimeSync).toBe('synchronized')
      expect(commands).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'snapshot', cwd: expect.stringContaining('projectless'), scope: { kind: 'global' } }),
        expect.objectContaining({ action: 'install', cwd: expect.stringContaining('project'), scope: { kind: 'project', workspaceId } }),
      ]))
      expect(events).toEqual(expect.arrayContaining([
        'install:queued',
        'install:running',
        'install:progress',
        'install:succeeded',
      ]))
      const marker = JSON.parse(await readFile(restartMarkerPath, 'utf8'))
      expect(marker.markers).toHaveLength(0)
      expect(reloadHosts).toHaveBeenCalledWith(
        { kind: 'project', workspaceId },
        expect.stringContaining('project'),
      )
      expect(restartHosts).not.toHaveBeenCalled()
      expect(runtimeHost.restart).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
      await service.dispose()
    }
  })

  it('falls back to the affected Host restart only when Runtime reload fails', async () => {
    const { reloadHosts, restartHosts, service } = await fixture()
    reloadHosts.mockRejectedValueOnce(new Error('Reload failed'))
    try {
      const installed = await service.install(
        { kind: 'project', workspaceId },
        'npm:project-fixture',
      )
      expect(installed).toMatchObject({
        runtimeSync: 'synchronized',
        snapshot: { restartRequired: false },
      })
      expect(restartHosts).toHaveBeenCalledOnce()
    } finally {
      await service.dispose()
    }
  })

  it('auto-installs MCP once and honors explicit removal opt-out', async () => {
    const work = await fixture()
    try {
      await Promise.all([
        work.service.ensureRecommendedPackages(),
        work.service.ensureRecommendedPackages(),
      ])
      expect(work.commands.filter((command) => command.action === 'install')).toEqual([
        expect.objectContaining({
          source: 'npm:pi-mcp-adapter',
          scope: { kind: 'global' },
        }),
      ])

      await work.service.remove({ kind: 'global' }, 'npm:pi-mcp-adapter')
      expect(JSON.parse(await readFile(work.managedPackageStatePath, 'utf8')))
        .toMatchObject({ version: 1, mcpOptedOut: true })

      const installsBefore = work.commands.filter((command) => command.action === 'install').length
      await work.service.ensureRecommendedPackages()
      expect(work.commands.filter((command) => command.action === 'install'))
        .toHaveLength(installsBefore)
    } finally {
      await work.service.dispose()
    }
  })

  it('keeps restart required visible when clearing the persisted marker fails', async () => {
    const { restartMarkerPath, service } = await fixture()
    await mkdir(restartMarkerPath, { recursive: true })
    try {
      const installed = await service.install(
        { kind: 'project', workspaceId },
        'npm:project-fixture',
      )
      expect(installed.snapshot).toMatchObject({
        restartRequired: true,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'PI_RESTART_MARKER_PERSIST_FAILED' }),
        ]),
      })

      const restarted = await service.restart({ kind: 'project', workspaceId })
      expect(restarted.snapshot.restartRequired).toBe(true)
      expect(restarted.snapshot.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'PI_RESTART_MARKER_PERSIST_FAILED' }),
      ]))
    } finally {
      await service.dispose()
    }
  })

  it('serializes mutations and rejects a result after the Pi scope changes', async () => {
    const work = await fixture()
    let releaseFirst: (() => void) | undefined
    work.helperRun.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releaseFirst = resolve })
      return payload('npm:first')
    })
    try {
      const first = work.service.install({ kind: 'project', workspaceId }, 'npm:first')
      const second = work.service.install({ kind: 'project', workspaceId }, 'npm:second')
      await vi.waitFor(() => expect(work.helperRun).toHaveBeenCalledTimes(1))
      releaseFirst?.()
      await first
      await second
      expect(work.helperRun).toHaveBeenCalledTimes(2)

      let releaseStale: (() => void) | undefined
      work.helperRun.mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => { releaseStale = resolve })
        return payload('npm:stale')
      })
      const stale = work.service.install({ kind: 'project', workspaceId }, 'npm:stale')
      await vi.waitFor(() => expect(work.helperRun).toHaveBeenCalledTimes(3))
          work.setScope({ kind: 'projectless' })
      releaseStale?.()
      await expect(stale).rejects.toMatchObject({
        code: 'PI_INTEGRATIONS_STALE',
      } satisfies Partial<LocalPiIntegrationError>)
    } finally {
      await work.service.dispose()
    }
  })

  it('persists the global retry value and synchronizes the selected scope effective value', async () => {
    const { commands, helperRun, runtimeHost, service } = await fixture()
    helperRun.mockImplementationOnce(async (command) => {
      commands.push(command)
      return payload(undefined, {
        globalEnabled: false,
        effectiveEnabled: true,
      })
    })
    try {
      const result = await service.setRetryEnabled({ kind: 'project', workspaceId }, false)
      expect(commands[commands.length - 1]).toMatchObject({ action: 'set-retry', enabled: false })
      expect(runtimeHost.request).toHaveBeenCalledWith({ type: 'set_auto_retry', enabled: true })
      expect(result).toMatchObject({
        runtimeSync: 'synchronized',
        snapshot: {
          retry: {
            globalEnabled: false,
            effective: { enabled: true, maxRetries: 3, baseDelayMs: 1000 },
          },
        },
      })
    } finally {
      await service.dispose()
    }
  })

  it('re-reads the active project effective value when retry is changed from global Settings', async () => {
    const { commands, helperRun, runtimeHost, service } = await fixture()
    helperRun
      .mockImplementationOnce(async (command) => {
        commands.push(command)
        return payload(undefined, {
          globalEnabled: false,
          effectiveEnabled: false,
        })
      })
      .mockImplementationOnce(async (command) => {
        commands.push(command)
        return payload(undefined, {
          globalEnabled: false,
          effectiveEnabled: true,
        })
      })
    try {
      const result = await service.setRetryEnabled({ kind: 'global' }, false)
      expect(commands).toEqual(expect.arrayContaining([
        expect.objectContaining({
          action: 'set-retry',
          scope: { kind: 'global' },
          cwd: expect.stringContaining('projectless'),
        }),
        expect.objectContaining({
          action: 'snapshot',
          scope: { kind: 'project', workspaceId },
          cwd: expect.stringContaining('project'),
        }),
      ]))
      expect(runtimeHost.request).toHaveBeenCalledWith({
        type: 'set_auto_retry',
        enabled: true,
      })
      expect(result).toMatchObject({
        runtimeSync: 'synchronized',
        snapshot: {
          scope: { kind: 'global' },
          retry: {
            globalEnabled: false,
            effective: { enabled: false },
          },
        },
      })
    } finally {
      await service.dispose()
    }
  })

  it('keeps a successful persistence visible when runtime synchronization fails', async () => {
    const { runtimeHost, service } = await fixture()
    runtimeHost.request.mockResolvedValueOnce({ success: false, error: 'Runtime rejected fixture' })
    try {
      const result = await service.setRetryEnabled({ kind: 'project', workspaceId }, false)
      expect(result).toMatchObject({
        runtimeSync: 'persisted-only',
        runtimeError: 'Runtime rejected fixture',
        snapshot: { retry: { globalEnabled: false } },
      })
    } finally {
      await service.dispose()
    }
  })

  it('does not sync a different runtime cwd and never syncs after persistence failure', async () => {
    const work = await fixture()
    try {
      work.setRuntime({
        state: 'ready',
        generation: 11,
        cwd: '/fixture/another-project',
      })
      const persistedOnly = await work.service.setRetryEnabled(
        { kind: 'project', workspaceId },
        false,
      )
      expect(persistedOnly.runtimeSync).toBe('persisted-only')
      expect(work.runtimeHost.request).not.toHaveBeenCalled()

      work.helperRun.mockRejectedValueOnce(new Error('Global retry write failed'))
      await expect(work.service.setRetryEnabled(
        { kind: 'project', workspaceId },
        true,
      )).rejects.toThrow('Global retry write failed')
      expect(work.runtimeHost.request).not.toHaveBeenCalled()
    } finally {
      await work.service.dispose()
    }
  })
})
