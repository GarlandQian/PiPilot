import { describe, expect, it, vi } from 'vitest'
import {
  piPackageSourceIsPinned,
  piPackageSourceType,
  updateConfiguredPackageForScope,
  type ScopedConfiguredPackage,
} from '../../src/main/local-pi-management/pi-package-scope'

function manager(packages: ScopedConfiguredPackage[]) {
  return {
    listConfiguredPackages: vi.fn(() => packages),
    install: vi.fn(async () => undefined),
  }
}

describe('scoped Pi package updates', () => {
  it.each([
    ['npm:package@1.2.3', true],
    ['npm:@scope/package@1.2.3-beta.1+build.5', true],
    ['npm:package@v1.2.3', true],
    ['npm:package@^1.2.0', false],
    ['npm:@scope/package@~1.2.0', false],
    ['npm:@scope/package@latest', false],
    ['git:https://example.test/team/package.git@v2', false],
    ['  git:https://example.test/team/package.git@v2  ', false],
    ['HTTPS://example.test/team/package.git@v2', false],
    [' npm:package@1.2.3 ', true],
    ['./local-package', true],
  ])('matches Pi update pin semantics for %s', (source, expected) => {
    expect(piPackageSourceIsPinned(source, piPackageSourceType(source))).toBe(expected)
  })

  it('updates only the selected scope when the same source exists globally and locally', async () => {
    const packageManager = manager([
      { source: 'npm:shared-package', scope: 'user' },
      { source: 'npm:shared-package', scope: 'project' },
    ])

    await updateConfiguredPackageForScope(
      packageManager,
      'npm:shared-package',
      { kind: 'project', workspaceId: '00000000-0000-4000-8000-000000000123' },
    )

    expect(packageManager.install).toHaveBeenCalledOnce()
    expect(packageManager.install).toHaveBeenCalledWith(
      'npm:shared-package',
      { local: true },
    )
  })

  it('reconciles a configured git ref through the selected global scope', async () => {
    const source = 'git:https://example.test/team/package.git@v2'
    const packageManager = manager([{ source, scope: 'user' }])

    await updateConfiguredPackageForScope(
      packageManager,
      source,
      { kind: 'global' },
    )

    expect(packageManager.install).toHaveBeenCalledWith(source, { local: false })
  })

  it('rejects missing-scope and pinned updates before installing', async () => {
    const packageManager = manager([
      { source: 'npm:project-only', scope: 'project' },
      { source: 'npm:pinned-package@1.0.0', scope: 'user' },
    ])

    await expect(updateConfiguredPackageForScope(
      packageManager,
      'npm:project-only',
      { kind: 'global' },
    )).rejects.toMatchObject({ code: 'PI_MANAGEMENT_PACKAGE_NOT_CONFIGURED' })
    await expect(updateConfiguredPackageForScope(
      packageManager,
      'npm:pinned-package@1.0.0',
      { kind: 'global' },
    )).rejects.toMatchObject({ code: 'PI_MANAGEMENT_PACKAGE_PINNED' })
    expect(packageManager.install).not.toHaveBeenCalled()
  })
})
