import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type DarwinUserPathAdapter,
  ExternalControlLauncherService,
  isSafePosixResolutionDirectoryOwner,
  mergeDarwinUserPath,
  mergeWindowsUserPath,
  parseWindowsUserPathRegistryExport,
  persistDarwinLauncherDirectory,
  persistDarwinLauncherDirectoryRemoval,
  persistWindowsLauncherDirectory,
  persistWindowsLauncherDirectoryRemoval,
  removeDarwinLauncherDirectory,
  removeWindowsLauncherDirectory,
  renderWindowsUserPathRegistryImport,
  renderExternalControlLauncherWrapper,
} from '../../src/main/external-control/launcher-service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'pipilot-launcher-'))
  roots.push(root)
  chmodSync(root, 0o700)
  const bin = join(root, 'bin')
  const state = join(root, 'state')
  mkdirSync(bin, { mode: 0o700 })
  mkdirSync(state, { mode: 0o700 })
  const executable = join(root, 'PiPilot')
  const descriptor = join(state, 'descriptor.json')
  const receipt = join(state, 'launcher-receipt.json')
  writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const create = (source = executable) => new ExternalControlLauncherService({
    descriptorPath: descriptor,
    executablePath: source,
    homeDirectory: root,
    isPackaged: false,
    platform: 'darwin',
    receiptPath: receipt,
    testTargetDirectory: bin,
  })
  return { bin, create, descriptor, executable, receipt, root }
}

function statefulDarwinPath(initial: string | null) {
  let value = initial
  const adapter: DarwinUserPathAdapter = {
    read: vi.fn(() => value),
    write: vi.fn((next) => { value = next }),
    remove: vi.fn(() => { value = null }),
  }
  return { adapter, get value() { return value }, set value(next) { value = next } }
}

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((complete) => { resolve = complete })
  return { promise, resolve }
}

function darwinHarness(initialPath: string | null = null) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'pipilot-darwin-launcher-'))
  roots.push(root)
  chmodSync(root, 0o700)
  const state = join(root, 'external-control')
  const bin = join(state, 'bin')
  mkdirSync(bin, { recursive: true, mode: 0o700 })
  const executable = join(root, 'PiPilot')
  const descriptor = join(state, 'descriptor.json')
  const receipt = join(state, 'launcher-receipt.json')
  writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const userPath = statefulDarwinPath(initialPath)
  const create = (
    targetDirectory = bin,
    fallbackPath = '/usr/bin:/bin:/usr/sbin:/sbin',
  ) => new ExternalControlLauncherService({
    darwinPrivateTargetDirectory: targetDirectory,
    darwinUserPath: userPath.adapter,
    descriptorPath: descriptor,
    environment: { PATH: fallbackPath },
    executablePath: executable,
    homeDirectory: root,
    isPackaged: true,
    platform: 'darwin',
    receiptPath: receipt,
  })
  return { bin, create, descriptor, executable, receipt, root, userPath }
}

describe('ExternalControlLauncherService', () => {
  it('installs one marked wrapper and private receipt into the injected stable target', async () => {
    const fixture = harness()
    const service = fixture.create()
    expect(await service.inspect()).toEqual({
      state: 'missing', managed: false, requiresClientRestart: false,
    })
    expect(await service.install()).toEqual({
      state: 'installed', managed: true, requiresClientRestart: false,
    })
    expect(await service.inspect()).toEqual({
      state: 'installed', managed: true, requiresClientRestart: false,
    })

    const launcher = join(fixture.bin, 'pipilot-mcp')
    expect(readFileSync(launcher, 'utf8')).toBe(renderExternalControlLauncherWrapper(
      fixture.executable,
      fixture.descriptor,
    ))
    expect(statSync(launcher).mode & 0o777).toBe(0o755)
    expect(statSync(fixture.receipt).mode & 0o077).toBe(0)
  })

  it('uninstalls only its marked wrapper and receipt and is idempotent afterward', async () => {
    const fixture = harness()
    const service = fixture.create()
    await service.install()
    const launcher = join(fixture.bin, 'pipilot-mcp')

    expect(await service.uninstall()).toEqual({
      state: 'missing', managed: false, requiresClientRestart: false,
    })
    expect(existsSync(launcher)).toBe(false)
    expect(existsSync(fixture.receipt)).toBe(false)
    expect(await service.uninstall()).toEqual({
      state: 'missing', managed: false, requiresClientRestart: false,
    })
  })

  it('cleans a valid stale receipt when its managed wrapper is already absent', async () => {
    const fixture = harness()
    const service = fixture.create()
    await service.install()
    unlinkSync(join(fixture.bin, 'pipilot-mcp'))

    expect(await service.uninstall()).toEqual({
      state: 'missing', managed: false, requiresClientRestart: false,
    })
    expect(existsSync(fixture.receipt)).toBe(false)
  })

  it('refuses an exact unreceipted wrapper and a received wrapper changed before removal', async () => {
    const unowned = harness()
    writeFileSync(
      join(unowned.bin, 'pipilot-mcp'),
      renderExternalControlLauncherWrapper(unowned.executable, unowned.descriptor),
      { mode: 0o755 },
    )
    await expect(unowned.create().uninstall()).rejects.toThrow('not managed')
    expect(existsSync(join(unowned.bin, 'pipilot-mcp'))).toBe(true)

    const changed = harness()
    const service = changed.create()
    await service.install()
    writeFileSync(join(changed.bin, 'pipilot-mcp'), '#!/bin/sh\nexit 9\n', { mode: 0o755 })
    await expect(service.uninstall()).rejects.toThrow('changed before removal')
    expect(existsSync(changed.receipt)).toBe(true)
  })

  it.skipIf(process.platform === 'win32')(
    'restores the wrapper without replacing a recreated target when receipt removal fails',
    async () => {
      const fixture = harness()
      const service = fixture.create()
      await service.install()
      const stateDirectory = join(fixture.root, 'state')
      chmodSync(stateDirectory, 0o500)
      try {
        await expect(service.uninstall()).rejects.toThrow()
        expect(readFileSync(join(fixture.bin, 'pipilot-mcp'), 'utf8')).toBe(
          renderExternalControlLauncherWrapper(fixture.executable, fixture.descriptor),
        )
        expect(existsSync(fixture.receipt)).toBe(true)
      } finally {
        chmodSync(stateDirectory, 0o700)
      }
    },
  )

  it('repairs a stale owned wrapper only when its receipt matches', async () => {
    const fixture = harness()
    await fixture.create().install()
    const movedExecutable = join(fixture.root, 'PiPilot-moved')
    writeFileSync(movedExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const moved = fixture.create(movedExecutable)
    expect((await moved.inspect()).state).toBe('repair')
    expect((await moved.install()).state).toBe('installed')
    expect(readFileSync(join(fixture.bin, 'pipilot-mcp'), 'utf8')).toContain(movedExecutable)
  })

  it('recovers an exact wrapper whose receipt write was interrupted', async () => {
    const fixture = harness()
    const wrapper = renderExternalControlLauncherWrapper(
      fixture.executable,
      fixture.descriptor,
    )
    writeFileSync(join(fixture.bin, 'pipilot-mcp'), wrapper, { mode: 0o755 })
    const service = fixture.create()
    expect((await service.inspect()).state).toBe('repair')
    expect((await service.install()).state).toBe('installed')
    expect(readFileSync(join(fixture.bin, 'pipilot-mcp'), 'utf8')).toBe(wrapper)
  })

  it('repairs an owned wrapper whose executable bit was removed', async () => {
    const fixture = harness()
    const service = fixture.create()
    await service.install()
    const launcher = join(fixture.bin, 'pipilot-mcp')
    chmodSync(launcher, 0o644)

    expect((await service.inspect()).state).toBe('repair')
    expect((await service.install()).state).toBe('installed')
    expect(statSync(launcher).mode & 0o777).toBe(0o755)
  })

  it('does not replace an unowned file that merely contains the marker text', async () => {
    const fixture = harness()
    writeFileSync(
      join(fixture.bin, 'pipilot-mcp'),
      '#!/bin/sh\necho "# PiPilot MCP launcher v1"\n',
      { mode: 0o755 },
    )
    const snapshot = (await fixture.create().inspect())
    expect(snapshot).toMatchObject({
      state: 'unsupported',
      error: { code: 'launcher_conflict' },
    })
  })

  it('rejects group-writable install directories and relative test targets', async () => {
    const fixture = harness()
    chmodSync(fixture.bin, 0o770)
    expect(await fixture.create().inspect()).toMatchObject({
      state: 'unsupported',
      error: { code: 'launcher_unsafe_target' },
    })
    const relative = new ExternalControlLauncherService({
      descriptorPath: fixture.descriptor,
      executablePath: fixture.executable,
      homeDirectory: fixture.root,
      isPackaged: false,
      platform: 'darwin',
      receiptPath: fixture.receipt,
      testTargetDirectory: 'relative-bin',
    })
    expect((await relative.inspect()).state).toBe('unsupported')
  })

  it.skipIf(process.platform === 'win32')(
    'allows sticky shared ancestors but rejects unsafe and symlinked ancestors',
    async () => {
      const root = mkdtempSync(join(realpathSync('/tmp'), 'pipilot-launcher-resolution-'))
      roots.push(root)
      chmodSync(root, 0o700)
      const executable = join(root, 'PiPilot')
      const descriptor = join(root, 'descriptor.json')
      const receipt = join(root, 'launcher-receipt.json')
      writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      const home = join(root, 'home')
      const bin = join(home, '.local', 'bin')
      mkdirSync(bin, { recursive: true, mode: 0o700 })
      const create = (homeDirectory: string, path: string) =>
        new ExternalControlLauncherService({
          descriptorPath: descriptor,
          environment: { PATH: path },
          executablePath: executable,
          homeDirectory,
          isPackaged: true,
          platform: 'darwin',
          receiptPath: receipt,
        })

      expect((await create(home, bin).inspect()).state).toBe('missing')

      chmodSync(home, 0o770)
      expect(await create(home, bin).inspect()).toMatchObject({
        state: 'unsupported',
        error: { code: 'launcher_unsafe_target' },
      })
      chmodSync(home, 0o700)

      const linkedHome = join(root, 'linked-home')
      symlinkSync(home, linkedHome)
      expect(await create(linkedHome, join(linkedHome, '.local', 'bin')).inspect()).toMatchObject({
        state: 'unsupported',
        error: { code: 'launcher_unsafe_target' },
      })
    },
  )

  it('does not throw during construction when the Windows registry tool is unavailable', async () => {
    expect(() => new ExternalControlLauncherService({
      descriptorPath: 'C:\\Users\\test\\AppData\\Roaming\\PiPilot\\descriptor.json',
      environment: {},
      executablePath: 'C:\\Program Files\\PiPilot\\pipilot-mcp.exe',
      homeDirectory: 'C:\\Users\\test',
      isPackaged: true,
      platform: 'win32',
      receiptPath: 'C:\\Users\\test\\AppData\\Roaming\\PiPilot\\launcher.json',
    })).not.toThrow()
  })
})

describe('macOS launchd user PATH', () => {
  it('coalesces status reads and serializes install/uninstall around an asynchronous probe', async () => {
    const fixture = darwinHarness()
    const service = fixture.create()
    const gate = deferred()
    const started = deferred()
    vi.mocked(fixture.userPath.adapter.read).mockImplementationOnce(async () => {
      started.resolve()
      await gate.promise
      return fixture.userPath.value
    })
    const first = service.inspect()
    const second = service.inspect()
    expect(second).toBe(first)
    await started.promise
    const install = service.install()
    const uninstall = service.uninstall()
    const after = service.inspect()
    expect(after).not.toBe(first)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(fixture.userPath.adapter.write).not.toHaveBeenCalled()
    gate.resolve()
    expect((await first).state).toBe('missing')
    expect((await install).state).toBe('installed')
    expect((await uninstall).state).toBe('missing')
    expect((await after).state).toBe('missing')
    expect(fixture.userPath.value).toBeNull()
    expect(existsSync(fixture.receipt)).toBe(false)
  })

  it('rolls back the PATH, wrapper, and receipt when the post-install probe times out', async () => {
    const fixture = darwinHarness()
    const service = fixture.create()
    vi.mocked(fixture.userPath.adapter.read).mockImplementation(async () => {
      if (existsSync(fixture.receipt)) throw new Error('probe timed out')
      return fixture.userPath.value
    })
    await expect(service.install()).rejects.toMatchObject({ code: 'launcher_install_failed' })
    expect(fixture.userPath.value).toBeNull()
    expect(existsSync(fixture.receipt)).toBe(false)
    expect(existsSync(join(fixture.bin, 'pipilot-mcp'))).toBe(false)
    // A failed transaction does not poison the operation lane.
    vi.mocked(fixture.userPath.adapter.read).mockImplementation(async () => fixture.userPath.value)
    expect((await service.install()).state).toBe('installed')
    expect((await service.uninstall()).state).toBe('missing')
  })

  it('does not replace a launcher changed externally while the verification probe is pending', async () => {
    const fixture = darwinHarness()
    const service = fixture.create()
    const launcher = join(fixture.bin, 'pipilot-mcp')
    const replacement = '#!/bin/sh\nexit 17\n'
    vi.mocked(fixture.userPath.adapter.read).mockImplementation(async () => {
      if (existsSync(fixture.receipt)) {
        writeFileSync(launcher, replacement, { mode: 0o755 })
        throw new Error('probe failed')
      }
      return fixture.userPath.value
    })
    await expect(service.install()).rejects.toBeDefined()
    expect(readFileSync(launcher, 'utf8')).toBe(replacement)
  })

  it('restores an owned repair and its previous receipt when asynchronous verification fails', async () => {
    const fixture = darwinHarness()
    const service = fixture.create()
    await service.install()
    const launcher = join(fixture.bin, 'pipilot-mcp')
    const previousReceipt = readFileSync(fixture.receipt, 'utf8')
    const previousPath = fixture.userPath.value
    chmodSync(launcher, 0o644)
    vi.mocked(fixture.userPath.adapter.read).mockImplementation(async () => {
      if ((statSync(launcher).mode & 0o100) !== 0) throw new Error('probe timed out')
      return fixture.userPath.value
    })
    await expect(service.install()).rejects.toMatchObject({ code: 'launcher_install_failed' })
    expect(fixture.userPath.value).toBe(previousPath)
    expect(statSync(launcher).mode & 0o777).toBe(0o644)
    expect(readFileSync(fixture.receipt, 'utf8')).toBe(previousReceipt)
  })

  it.each([null, '/usr/bin:/bin'])(
    'retains PATH ownership when repairing an owned wrapper installed over %s',
    async (originalPath) => {
      const fixture = darwinHarness(originalPath)
      const service = fixture.create()
      await service.install()
      const launcher = join(fixture.bin, 'pipilot-mcp')
      const ownedMetadata = JSON.parse(readFileSync(fixture.receipt, 'utf8')).darwin
      chmodSync(launcher, 0o644)

      expect((await service.inspect()).state).toBe('repair')
      expect((await service.install()).state).toBe('installed')
      expect(statSync(launcher).mode & 0o777).toBe(0o755)
      expect(JSON.parse(readFileSync(fixture.receipt, 'utf8')).darwin).toEqual(ownedMetadata)

      expect(await service.uninstall()).toEqual({
        state: 'missing', managed: false, requiresClientRestart: true,
      })
      expect(fixture.userPath.value).toBe(originalPath)
      expect(existsSync(launcher)).toBe(false)
      expect(existsSync(fixture.receipt)).toBe(false)
    },
  )

  it('restores PATH and retains ownership when uninstall verification fails', async () => {
    const fixture = darwinHarness()
    const service = fixture.create()
    await service.install()
    const previousPath = fixture.userPath.value
    const previousReceipt = readFileSync(fixture.receipt, 'utf8')
    vi.mocked(fixture.userPath.adapter.read)
      .mockResolvedValueOnce(previousPath)
      .mockRejectedValueOnce(new Error('probe timed out'))
    await expect(service.uninstall()).rejects.toMatchObject({ code: 'launcher_uninstall_failed' })
    expect(fixture.userPath.value).toBe(previousPath)
    expect(readFileSync(fixture.receipt, 'utf8')).toBe(previousReceipt)
    expect(existsSync(join(fixture.bin, 'pipilot-mcp'))).toBe(true)
    expect((await service.uninstall()).state).toBe('missing')
  })

  it('installs from Finder PATH when launchd PATH is unset and restores the default on uninstall', async () => {
    const fixture = darwinHarness()
    const service = fixture.create()

    expect(await service.inspect()).toEqual({
      state: 'missing', managed: false, requiresClientRestart: false,
    })
    expect(await service.install()).toEqual({
      state: 'installed', managed: true, requiresClientRestart: true,
    })
    expect(fixture.userPath.value).toBe(
      `${fixture.bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    )
    expect(JSON.parse(readFileSync(fixture.receipt, 'utf8'))).toMatchObject({
      darwin: {
        insertedSeparator: true,
        pathEntryAdded: true,
        pathValueCreated: true,
      },
    })

    expect(await service.uninstall()).toEqual({
      state: 'missing', managed: false, requiresClientRestart: true,
    })
    expect(fixture.userPath.value).toBeNull()
    expect(existsSync(join(fixture.bin, 'pipilot-mcp'))).toBe(false)
    expect(existsSync(fixture.receipt)).toBe(false)
  })

  it('prepends and removes exactly its entry while preserving unrelated PATH bytes', async () => {
    const fixture = darwinHarness()
    const original = `/opt/homebrew/bin::relative:${fixture.bin}:/usr/bin:`
    fixture.userPath.value = original
    const service = fixture.create()

    expect((await service.install()).requiresClientRestart).toBe(true)
    expect(fixture.userPath.value).toBe(`${fixture.bin}:${original}`)
    expect((await service.uninstall()).requiresClientRestart).toBe(true)
    expect(fixture.userPath.value).toBe(original)
  })

  it('does not remove a private-directory PATH entry that PiPilot did not add', async () => {
    const fixture = darwinHarness()
    fixture.userPath.value = `${fixture.bin}:/usr/bin:/bin`
    const service = fixture.create()

    expect(await service.install()).toEqual({
      state: 'installed', managed: true, requiresClientRestart: false,
    })
    expect(await service.uninstall()).toEqual({
      state: 'missing', managed: false, requiresClientRestart: false,
    })
    expect(fixture.userPath.value).toBe(`${fixture.bin}:/usr/bin:/bin`)
  })

  it('recovers a valid managed launcher after launchd PATH is reset', async () => {
    const fixture = darwinHarness()
    await fixture.create().install()
    fixture.userPath.value = null

    const restored = fixture.create()
    expect(await restored.initialize()).toEqual({
      state: 'installed', managed: true, requiresClientRestart: true,
    })
    expect(fixture.userPath.value).toBe(
      `${fixture.bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    )
  })

  it('restores launchd PATH even when the inherited fallback already starts with the launcher', async () => {
    const fixture = darwinHarness()
    await fixture.create().install()
    fixture.userPath.value = null

    const restored = fixture.create(
      fixture.bin,
      `${fixture.bin}:/usr/bin:/bin`,
    )
    expect(await restored.initialize()).toEqual({
      state: 'installed', managed: true, requiresClientRestart: true,
    })
    expect(fixture.userPath.value).toBe(`${fixture.bin}:/usr/bin:/bin`)
  })

  it('rejects unsafe and symlinked private target directories', async () => {
    const unsafe = darwinHarness()
    chmodSync(unsafe.bin, 0o770)
    expect(await unsafe.create().inspect()).toMatchObject({
      state: 'unsupported',
      error: { code: 'launcher_unsafe_target' },
    })

    const linked = darwinHarness()
    const linkedBin = join(linked.root, 'linked-bin')
    symlinkSync(linked.bin, linkedBin)
    expect(await linked.create(linkedBin).inspect()).toMatchObject({
      state: 'unsupported',
      error: { code: 'launcher_unsafe_target' },
    })
  })

  it('rolls PATH back exactly when install or uninstall completion fails', async () => {
    const original = '/usr/bin:/bin'
    const installPath = statefulDarwinPath(original)
    await expect(persistDarwinLauncherDirectory(
      installPath.adapter,
      undefined,
      '/private/pipilot/bin',
      () => { throw new Error('receipt failed') },
    )).rejects.toThrow('receipt failed')
    expect(installPath.value).toBe(original)

    const merged = mergeDarwinUserPath(original, undefined, '/private/pipilot/bin')
    const uninstallPath = statefulDarwinPath(merged.value)
    await expect(persistDarwinLauncherDirectoryRemoval(
      uninstallPath.adapter,
      '/private/pipilot/bin',
      merged.metadata,
      () => { throw new Error('file removal failed') },
    )).rejects.toThrow('file removal failed')
    expect(uninstallPath.value).toBe(merged.value)
  })

  it('preserves later PATH changes and validates resolution directory ownership', async () => {
    const directory = '/private/pipilot/bin'
    const merged = mergeDarwinUserPath(null, '/usr/bin:/bin', directory)
    expect(removeDarwinLauncherDirectory(
      `${merged.value}:/later/tooling`,
      directory,
      merged.metadata,
    )).toEqual({
      changed: true,
      value: '/usr/bin:/bin:/later/tooling',
    })
    expect(isSafePosixResolutionDirectoryOwner(0, 501)).toBe(true)
    expect(isSafePosixResolutionDirectoryOwner(501, 501)).toBe(true)
    expect(isSafePosixResolutionDirectoryOwner(502, 501)).toBe(false)
  })
})

describe('Windows user PATH merge', () => {
  it('round-trips Unicode, whitespace, empty entries, and both registry string types', async () => {
    for (const type of ['REG_SZ', 'REG_EXPAND_SZ'] as const) {
      const value = {
        type,
        value: '  C:\\工具;;%USERPROFILE%\\bin;C:\\Program Files\\PiPilot  ',
      }
      expect(parseWindowsUserPathRegistryExport(
        renderWindowsUserPathRegistryImport(value),
      )).toEqual(value)
    }
  })

  it('parses the quoted REG_SZ form emitted by reg export without trimming it', async () => {
    const text = [
      'Windows Registry Editor Version 5.00',
      '',
      '[HKEY_CURRENT_USER\\Environment]',
      '"Path"="  C:\\\\工具;\\"quoted\\";  "',
      '',
    ].join('\r\n')
    const bytes = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(text, 'utf16le'),
    ])
    expect(parseWindowsUserPathRegistryExport(bytes)).toEqual({
      type: 'REG_SZ',
      value: '  C:\\工具;"quoted";  ',
    })
  })

  it('returns null for an absent PATH and rejects malformed or duplicate values', async () => {
    const encode = (lines: string[]) => Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(lines.join('\r\n'), 'utf16le'),
    ])
    const header = [
      'Windows Registry Editor Version 5.00',
      '',
      '[HKEY_CURRENT_USER\\Environment]',
    ]
    expect(parseWindowsUserPathRegistryExport(encode([
      ...header,
      '"TEMP"="C:\\\\Temp"',
      '',
    ]))).toBeNull()
    expect(() => parseWindowsUserPathRegistryExport(encode([
      ...header,
      '"Path"="C:\\\\One"',
      '"PATH"="C:\\\\Two"',
      '',
    ]))).toThrow('duplicate PATH')
    expect(() => parseWindowsUserPathRegistryExport(encode([
      ...header,
      '"Path"=hex(2):41,00',
      '',
    ]))).toThrow('not NUL terminated')
    expect(() => parseWindowsUserPathRegistryExport(encode([
      ...header,
      '"Path"="C:\\\\One"Two"',
      '',
    ]))).toThrow('unescaped quote')
  })

  it('preserves the original value verbatim and appends once', async () => {
    const original = 'C:\\Tools;;%USERPROFILE%\\bin;'
    expect(mergeWindowsUserPath(original, 'C:\\Program Files\\PiPilot')).toEqual({
      changed: true,
      value: `${original}C:\\Program Files\\PiPilot`,
    })
    expect(mergeWindowsUserPath(
      'C:\\Tools;C:\\Program Files\\PiPilot\\',
      'c:\\program files\\pipilot',
    )).toEqual({
      changed: false,
      value: 'C:\\Tools;C:\\Program Files\\PiPilot\\',
    })
  })

  it('removes exactly one managed entry without normalizing unrelated PATH text', async () => {
    const metadata = { insertedSeparator: true, pathValueCreated: false }
    expect(removeWindowsLauncherDirectory(
      '  C:\\One;;C:\\Program Files\\PiPilot  ;%USERPROFILE%\\bin;',
      'c:\\program files\\pipilot',
      metadata,
    )).toEqual({
      changed: true,
      value: '  C:\\One;;%USERPROFILE%\\bin;',
    })
    expect(removeWindowsLauncherDirectory(
      'C:\\One;;C:\\Program Files\\PiPilot;%USERPROFILE%\\bin',
      'C:\\Program Files\\PiPilot',
      { insertedSeparator: false, pathValueCreated: false },
    )).toEqual({
      changed: true,
      value: 'C:\\One;;;%USERPROFILE%\\bin',
    })
    expect(() => removeWindowsLauncherDirectory(
      'C:\\Program Files\\PiPilot;C:\\PROGRAM FILES\\PIPILOT',
      'C:\\Program Files\\PiPilot',
      metadata,
    )).toThrow('ambiguous')
  })

  it('preserves PATH type and removes a PiPilot-created empty registry value', async () => {
    const original = {
      type: 'REG_SZ' as const,
      value: 'C:\\Program Files\\PiPilot',
    }
    const write = vi.fn()
    const adapter = {
      read: vi.fn()
        .mockReturnValueOnce(original)
        .mockReturnValueOnce({ type: 'REG_SZ', value: '' }),
      write,
      remove: vi.fn(),
    }
    expect(await persistWindowsLauncherDirectoryRemoval(
      adapter,
      'C:\\Program Files\\PiPilot',
      { insertedSeparator: false, pathValueCreated: false },
    )).toBe(true)
    expect(write).toHaveBeenCalledWith({ type: 'REG_SZ', value: '' })
    expect(adapter.remove).not.toHaveBeenCalled()

    const createdAdapter = {
      read: vi.fn().mockReturnValueOnce(original).mockReturnValueOnce(null),
      write: vi.fn(),
      remove: vi.fn(),
    }
    expect(await persistWindowsLauncherDirectoryRemoval(
      createdAdapter,
      'C:\\Program Files\\PiPilot',
      { insertedSeparator: false, pathValueCreated: true },
    )).toBe(true)
    expect(createdAdapter.remove).toHaveBeenCalledOnce()
    expect(createdAdapter.write).not.toHaveBeenCalled()
  })

  it('restores the exact original PATH when removal verification or receipt cleanup fails', async () => {
    const original = {
      type: 'REG_EXPAND_SZ' as const,
      value: '%USERPROFILE%\\bin;;C:\\Program Files\\PiPilot',
    }
    const corruptedAdapter = {
      read: vi.fn()
        .mockReturnValueOnce(original)
        .mockReturnValueOnce({ type: 'REG_EXPAND_SZ', value: 'corrupted' })
        .mockReturnValueOnce(original),
      write: vi.fn(),
      remove: vi.fn(),
    }
    await expect(persistWindowsLauncherDirectoryRemoval(
      corruptedAdapter,
      'C:\\Program Files\\PiPilot',
      { insertedSeparator: true, pathValueCreated: false },
    )).rejects.toThrow('did not persist exactly')
    expect(corruptedAdapter.write).toHaveBeenNthCalledWith(2, original)

    const receiptAdapter = {
      read: vi.fn()
        .mockReturnValueOnce(original)
        .mockReturnValueOnce({ type: 'REG_EXPAND_SZ', value: '%USERPROFILE%\\bin;' })
        .mockReturnValueOnce(original),
      write: vi.fn(),
      remove: vi.fn(),
    }
    await expect(persistWindowsLauncherDirectoryRemoval(
      receiptAdapter,
      'C:\\Program Files\\PiPilot',
      { insertedSeparator: true, pathValueCreated: false },
      () => { throw new Error('receipt removal failed') },
    )).rejects.toThrow('receipt removal failed')
    expect(receiptAdapter.write).toHaveBeenNthCalledWith(2, original)
  })

  it('fails closed when the original PATH cannot be verified after uninstall rollback', async () => {
    const original = {
      type: 'REG_EXPAND_SZ' as const,
      value: '%USERPROFILE%\\bin;;C:\\Program Files\\PiPilot',
    }
    const adapter = {
      read: vi.fn()
        .mockReturnValueOnce(original)
        .mockReturnValueOnce({ type: 'REG_EXPAND_SZ', value: '%USERPROFILE%\\bin;' })
        .mockReturnValueOnce({ type: 'REG_EXPAND_SZ', value: 'still-corrupted' }),
      write: vi.fn(),
      remove: vi.fn(),
    }

    await expect(persistWindowsLauncherDirectoryRemoval(
      adapter,
      'C:\\Program Files\\PiPilot',
      { insertedSeparator: true, pathValueCreated: false },
      () => { throw new Error('receipt removal failed') },
    )).rejects.toThrow('rollback did not persist exactly')
    expect(adapter.write).toHaveBeenNthCalledWith(2, original)
  })

  it('fails closed when restoring the original PATH after uninstall throws', async () => {
    const original = {
      type: 'REG_SZ' as const,
      value: 'C:\\Tools;C:\\Program Files\\PiPilot',
    }
    const adapter = {
      read: vi.fn()
        .mockReturnValueOnce(original)
        .mockReturnValueOnce({ type: 'REG_SZ', value: 'C:\\Tools' }),
      write: vi.fn()
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => { throw new Error('restore failed') }),
      remove: vi.fn(),
    }

    await expect(persistWindowsLauncherDirectoryRemoval(
      adapter,
      'C:\\Program Files\\PiPilot',
      { insertedSeparator: true, pathValueCreated: false },
      () => { throw new Error('receipt removal failed') },
    )).rejects.toThrow('rollback did not persist exactly')
    expect(adapter.write).toHaveBeenNthCalledWith(2, original)
  })

  it('reads back the exact value and restores the original on mismatch', async () => {
    const original = { type: 'REG_SZ' as const, value: 'C:\\Original;;' }
    const write = vi.fn()
    const adapter = {
      read: vi.fn()
        .mockReturnValueOnce(original)
        .mockReturnValueOnce({ type: 'REG_SZ', value: 'C:\\corrupted' }),
      write,
      remove: vi.fn(),
    }
    await expect(persistWindowsLauncherDirectory(
      adapter,
      'C:\\Program Files\\PiPilot',
    )).rejects.toThrow('did not persist exactly')
    expect(write).toHaveBeenNthCalledWith(1, {
      type: 'REG_SZ',
      value: 'C:\\Original;;C:\\Program Files\\PiPilot',
    })
    expect(write).toHaveBeenNthCalledWith(2, original)
    expect(adapter.remove).not.toHaveBeenCalled()
  })

  it('removes a newly created value when post-write verification fails', async () => {
    const adapter = {
      read: vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(null),
      write: vi.fn(),
      remove: vi.fn(),
    }
    await expect(persistWindowsLauncherDirectory(
      adapter,
      'C:\\Program Files\\PiPilot',
    )).rejects.toThrow('did not persist exactly')
    expect(adapter.remove).toHaveBeenCalledOnce()
  })

  it('restores the original PATH when the private receipt write fails', async () => {
    const original = { type: 'REG_EXPAND_SZ' as const, value: '%USERPROFILE%\\bin' }
    const adapter = {
      read: vi.fn()
        .mockReturnValueOnce(original)
        .mockReturnValueOnce({
          type: 'REG_EXPAND_SZ',
          value: '%USERPROFILE%\\bin;C:\\Program Files\\PiPilot',
        }),
      write: vi.fn(),
      remove: vi.fn(),
    }
    await expect(persistWindowsLauncherDirectory(
      adapter,
      'C:\\Program Files\\PiPilot',
      () => { throw new Error('receipt write failed') },
    )).rejects.toThrow('receipt write failed')
    expect(adapter.write).toHaveBeenNthCalledWith(2, original)
    expect(adapter.remove).not.toHaveBeenCalled()
  })

  it('attempts rollback when the registry write reports failure', async () => {
    const original = { type: 'REG_SZ' as const, value: 'C:\\Original' }
    const adapter = {
      read: vi.fn().mockReturnValueOnce(original),
      write: vi.fn()
        .mockImplementationOnce(() => { throw new Error('write failed') })
        .mockImplementationOnce(() => undefined),
      remove: vi.fn(),
    }
    await expect(persistWindowsLauncherDirectory(
      adapter,
      'C:\\Program Files\\PiPilot',
    )).rejects.toThrow('write failed')
    expect(adapter.write).toHaveBeenNthCalledWith(2, original)
  })
})
