import { describe, expect, it, vi } from 'vitest'
import {
  ApplicationUpdateProviderError,
  DisabledApplicationUpdateProvider,
  ElectronUpdaterProvider,
  GithubReleaseProvider,
  type ApplicationUpdateProvider,
  type ApplicationUpdateProviderEvent,
} from '../../src/main/application-update/providers'
import { ApplicationUpdateService } from '../../src/main/application-update/service'
import {
  APPLICATION_UPDATE_RELEASE_URL,
  applicationUpdatePolicySchema,
  type ApplicationUpdatePolicy,
} from '../../src/shared/application-update'

function policy(
  platform: ApplicationUpdatePolicy['platform'],
  pkg: ApplicationUpdatePolicy['package'],
  capability: ApplicationUpdatePolicy['capability'],
): ApplicationUpdatePolicy {
  return applicationUpdatePolicySchema.parse({
    platform,
    package: pkg,
    capability,
    currentVersion: '0.0.1',
    releaseUrl: APPLICATION_UPDATE_RELEASE_URL,
  })
}

class FakeProvider implements ApplicationUpdateProvider {
  readonly policy = policy('linux', 'appimage', 'native-install')
  readonly listeners = new Set<(event: ApplicationUpdateProviderEvent) => void>()
  checkCalls = 0
  downloadCalls = 0
  installCalls = 0
  checkResult: 'current' | { version: string; releaseUrl: string; releaseSummary: string | null; releaseDate: string | null } = {
    version: '0.0.2',
    releaseUrl: 'https://github.com/GarlandQian/PiPilot/releases/tag/v0.0.2',
    releaseSummary: 'update',
    releaseDate: '2026-08-13T00:00:00.000Z',
  }

  async check() {
    this.checkCalls += 1
    await Promise.resolve()
    return this.checkResult
  }

  async download() {
    this.downloadCalls += 1
  }

  install() {
    this.installCalls += 1
  }

  subscribe(listener: (event: ApplicationUpdateProviderEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: ApplicationUpdateProviderEvent) {
    for (const listener of this.listeners) listener(event)
  }

  dispose() {
    this.listeners.clear()
  }
}

describe('application update policy', () => {
  it('keeps development disabled, macOS and unproven Windows manual, and Linux package-specific', async () => {
    const { createApplicationUpdatePolicy } = await import('../../src/main/application-update/providers')
    expect(createApplicationUpdatePolicy({ packaged: false, currentVersion: '0.0.1', platform: 'darwin' }).reason)
      .toBe('development')
    expect(createApplicationUpdatePolicy({ packaged: true, currentVersion: '0.0.1', platform: 'darwin' }).policy.capability)
      .toBe('manual-release')
    expect(createApplicationUpdatePolicy({ packaged: true, currentVersion: '0.0.1', platform: 'win32' }).policy)
      .toMatchObject({ package: 'nsis', capability: 'manual-release' })
    expect(createApplicationUpdatePolicy({ packaged: true, currentVersion: '0.0.1', platform: 'win32', enableWindowsNative: true }).policy.capability)
      .toBe('native-install')
    expect(createApplicationUpdatePolicy({ packaged: true, currentVersion: '0.0.1', platform: 'linux', appImagePath: '/tmp/PiPilot.AppImage' }).policy.package)
      .toBe('appimage')
    expect(createApplicationUpdatePolicy({ packaged: true, currentVersion: '0.0.1', platform: 'linux' }).policy.package)
      .toBe('deb')
  })
})

describe('GitHub release provider', () => {
  it('accepts only a newer stable public release', async () => {
    const provider = new GithubReleaseProvider({
      currentVersion: '0.0.1',
      platform: 'darwin',
      fetch: vi.fn(async () => new Response(JSON.stringify({
        tag_name: 'v0.0.2',
        html_url: 'https://github.com/GarlandQian/PiPilot/releases/tag/v0.0.2',
        body: 'notes',
        published_at: '2026-08-13T00:00:00.000Z',
        draft: false,
        prerelease: false,
      }), { status: 200 })),
    })
    await expect(provider.check()).resolves.toMatchObject({ version: '0.0.2' })
    provider.dispose()
  })

  it('rejects draft and prerelease responses', async () => {
    const provider = new GithubReleaseProvider({
      currentVersion: '0.0.1',
      platform: 'darwin',
      fetch: vi.fn(async () => new Response(JSON.stringify({
        tag_name: 'v0.0.2',
        html_url: 'https://github.com/GarlandQian/PiPilot/releases/tag/v0.0.2',
        body: null,
        published_at: '2026-08-13T00:00:00.000Z',
        draft: true,
        prerelease: false,
      }), { status: 200 })),
    })
    await expect(provider.check()).rejects.toMatchObject({ code: 'UPDATE_INVALID_RELEASE' })
    provider.dispose()
  })

  it('preserves the Windows NSIS identity while using the manual release checker', async () => {
    const windowsPolicy = applicationUpdatePolicySchema.parse({
      platform: 'windows',
      package: 'nsis',
      capability: 'manual-release',
      currentVersion: '0.0.1',
      releaseUrl: APPLICATION_UPDATE_RELEASE_URL,
    })
    const provider = new GithubReleaseProvider({
      currentVersion: '0.0.1',
      platform: 'win32',
      policy: windowsPolicy,
      fetch: vi.fn(async () => new Response(JSON.stringify({
        tag_name: 'v0.0.2',
        html_url: 'https://github.com/GarlandQian/PiPilot/releases/tag/v0.0.2',
        body: 'notes',
        published_at: '2026-08-13T00:00:00.000Z',
        draft: false,
        prerelease: false,
      }), { status: 200 })),
    })

    expect(provider.policy).toEqual(windowsPolicy)
    await expect(provider.check()).resolves.toMatchObject({ version: '0.0.2' })
    provider.dispose()
  })

  it('stops reading a GitHub response after the bounded byte limit', async () => {
    let cancelled = false
    const oversized = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(128_001))
      },
      cancel() {
        cancelled = true
      },
    })
    const provider = new GithubReleaseProvider({
      currentVersion: '0.0.1',
      platform: 'darwin',
      fetch: vi.fn(async () => new Response(oversized, { status: 200 })),
    })

    await expect(provider.check()).rejects.toMatchObject({ code: 'UPDATE_INVALID_FEED' })
    expect(cancelled).toBe(true)
    provider.dispose()
  })
})

describe('Electron updater provider', () => {
  it('maps a generic updater error to the service operation that owns it', async () => {
    const listeners = new Map<string, (...args: never[]) => void>()
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowDowngrade: true,
      allowPrerelease: true,
      channel: null,
      on: vi.fn((event: string, listener: (...args: never[]) => void) => {
        listeners.set(event, listener)
      }),
      removeListener: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(async () => {
        listeners.get('error')?.()
        throw new Error('download failed')
      }),
      quitAndInstall: vi.fn(),
    }
    const provider = new ElectronUpdaterProvider({
      updater: updater as never,
      policy: policy('linux', 'appimage', 'native-install'),
    })
    const service = new ApplicationUpdateService({ provider, startupDelayMs: 999_999 })

    updater.checkForUpdates.mockResolvedValueOnce({
      isUpdateAvailable: true,
      updateInfo: {
        version: '0.0.2',
        releaseDate: '2026-08-13T00:00:00.000Z',
        files: [],
        path: '',
        sha512: '',
      },
    })
    await service.check()
    await service.download()

    expect(service.getSnapshot()).toMatchObject({
      state: 'error',
      operation: 'download',
      code: 'UPDATE_DOWNLOAD_FAILED',
      retryState: 'available',
    })
    service.dispose()
  })

  it('clears release-only state before checking again after an available result', async () => {
    const provider = new FakeProvider()
    const service = new ApplicationUpdateService({ provider, startupDelayMs: 999_999 })

    await service.check()
    expect(service.getSnapshot().state).toBe('available')
    provider.checkResult = 'current'

    await expect(service.check()).resolves.toMatchObject({
      snapshot: { state: 'current' },
    })
    expect(service.getSnapshot()).not.toHaveProperty('capability')
    expect(service.getSnapshot()).not.toHaveProperty('availableVersion')
    service.dispose()
  })
})

describe('ApplicationUpdateService', () => {
  it('coalesces checks, exposes an available update, downloads, and confirms active work before install', async () => {
    const provider = new FakeProvider()
    let shutdownInstall: (() => void) | undefined
    const service = new ApplicationUpdateService({
      provider,
      startupDelayMs: 999_999,
      hasActiveWork: () => ({ primaryPi: true, runtimePool: false, terminals: false }),
      requestInstallShutdown: (install) => {
        shutdownInstall = install
      },
    })

    const first = service.check()
    const second = service.check()
    expect(first).toBe(second)
    await expect(first).resolves.toMatchObject({ snapshot: { state: 'available', availableVersion: '0.0.2' } })
    expect(provider.checkCalls).toBe(1)

    await expect(service.download()).resolves.toMatchObject({ snapshot: { state: 'downloaded' } })
    expect(provider.downloadCalls).toBe(1)
    await expect(service.install()).resolves.toMatchObject({ outcome: 'confirmation-required' })
    expect(provider.installCalls).toBe(0)
    await expect(service.install(true)).resolves.toMatchObject({ outcome: 'accepted' })
    expect(shutdownInstall).toBeTypeOf('function')
    shutdownInstall?.()
    expect(provider.installCalls).toBe(1)
    service.dispose()
  })

  it('does not contact a disabled provider when checking', async () => {
    const provider = new DisabledApplicationUpdateProvider(
      policy('unsupported', 'unsupported', null),
      'unsupported-platform',
    )
    const check = vi.spyOn(provider, 'check')
    const service = new ApplicationUpdateService({ provider })
    await service.check()
    expect(check).not.toHaveBeenCalled()
    expect(service.getSnapshot().state).toBe('disabled')
    service.dispose()
  })

  it('maps provider failures to bounded typed error snapshots', async () => {
    const provider = new FakeProvider()
    provider.check = async () => {
      throw new ApplicationUpdateProviderError('UPDATE_NETWORK_UNAVAILABLE', 'secret details')
    }
    const service = new ApplicationUpdateService({ provider, startupDelayMs: 999_999 })
    await service.check()
    expect(service.getSnapshot()).toMatchObject({
      state: 'error',
      code: 'UPDATE_NETWORK_UNAVAILABLE',
    })
    expect(JSON.stringify(service.getSnapshot())).not.toContain('secret details')
    service.dispose()
  })

  it('ignores provider events that arrive after their operation has settled', async () => {
    const provider = new FakeProvider()
    const service = new ApplicationUpdateService({
      provider,
      startupDelayMs: 999_999,
    })

    await service.check()
    const settled = service.getSnapshot()
    expect(settled.state).toBe('available')

    provider.emit({
      type: 'error',
      error: new ApplicationUpdateProviderError(
        'UPDATE_CHECK_FAILED',
        'late provider error',
      ),
    })

    expect(service.getSnapshot()).toEqual(settled)
    service.dispose()
  })
})
