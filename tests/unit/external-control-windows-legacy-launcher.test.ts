import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExternalControlLauncherService,
  type WindowsUserPathAdapter,
  type WindowsUserPathValue,
} from '../../src/main/external-control/launcher-service'

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return { ...original, renameSync: vi.fn(original.renameSync) }
})

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function harness(initial: WindowsUserPathValue | null) {
  const root = mkdtempSync(join(tmpdir(), 'pipilot-legacy-launcher-'))
  roots.push(root)
  const directory = join(root, '中文用户', 'Programs', 'PiPilot Desktop')
  const stateDirectory = join(root, '中文用户', 'Roaming', 'PiPilot', 'external-control')
  mkdirSync(directory, { recursive: true })
  mkdirSync(stateDirectory, { recursive: true })
  const executablePath = join(directory, 'pipilot-mcp.exe')
  const receiptPath = join(stateDirectory, 'launcher-receipt.json')
  writeFileSync(executablePath, 'fixture executable')
  // Historical fingerprints differ from the current directory hash. An opaque
  // legacy fingerprint must never establish ownership of an existing PATH.
  const legacy = {
    version: 1,
    platform: 'win32',
    launcherPath: executablePath,
    fingerprint: 'b'.repeat(64),
  }
  const writeReceipt = (value: unknown) => writeFileSync(receiptPath, `${JSON.stringify(value)}\n`)
  writeReceipt(legacy)
  let value = initial
  const adapter: WindowsUserPathAdapter = {
    read: vi.fn(() => value),
    write: vi.fn((next) => { value = next }),
    remove: vi.fn(() => { value = null }),
  }
  const service = new ExternalControlLauncherService({
    descriptorPath: join(stateDirectory, 'descriptor.json'),
    executablePath,
    homeDirectory: root,
    isPackaged: true,
    platform: 'win32',
    receiptPath,
    windowsUserPath: adapter,
  })
  return {
    adapter, directory, legacy, receiptPath, service, writeReceipt,
    get value() { return value },
    set value(next) { value = next },
  }
}

describe.skipIf(process.platform !== 'win32')('Windows legacy launcher receipts', () => {
  it('recognizes a legacy installation without claiming or modifying its existing PATH', async () => {
    const fixture = harness(null)
    fixture.value = {
      type: 'REG_EXPAND_SZ',
      value: ` C:\\工具;;%USERPROFILE%\\bin;${fixture.directory.toUpperCase()}\\;C:\\After`,
    }
    fixture.writeReceipt({ ...fixture.legacy, launcherPath: fixture.legacy.launcherPath.toUpperCase() })
    const receiptBefore = readFileSync(fixture.receiptPath, 'utf8')
    const pathBefore = fixture.value
    const expected = { state: 'installed', managed: false, requiresClientRestart: false }

    expect(await fixture.service.inspect()).toEqual(expected)
    expect(await fixture.service.initialize()).toEqual(expected)
    expect(await fixture.service.install()).toEqual(expected)
    await expect(fixture.service.uninstall()).rejects.toMatchObject({ code: 'launcher_conflict' })

    expect(fixture.value).toEqual(pathBefore)
    expect(readFileSync(fixture.receiptPath, 'utf8')).toBe(receiptBefore)
    expect(fixture.adapter.write).not.toHaveBeenCalled()
    expect(fixture.adapter.remove).not.toHaveBeenCalled()
  })

  it.each(['REG_SZ', 'REG_EXPAND_SZ'] as const)(
    'creates a v2 receipt for a new %s PATH edit and restores unrelated PATH bytes',
    async (type) => {
      const original = { type, value: ' C:\\工具;;%USERPROFILE%\\bin' }
      const fixture = harness(original)
      const receiptBefore = readFileSync(fixture.receiptPath, 'utf8')

      expect(await fixture.service.inspect()).toEqual({
        state: 'missing', managed: false, requiresClientRestart: false,
      })
      expect(readFileSync(fixture.receiptPath, 'utf8')).toBe(receiptBefore)
      expect(await fixture.service.install()).toEqual({
        state: 'installed', managed: true, requiresClientRestart: true,
      })
      expect(fixture.value).toEqual({
        type: original.type,
        value: `${original.value};${fixture.directory}`,
      })
      expect(JSON.parse(readFileSync(fixture.receiptPath, 'utf8'))).toMatchObject({
        version: 2,
        platform: 'win32',
        launcherPath: fixture.legacy.launcherPath,
        windows: { insertedSeparator: true, pathValueCreated: false },
      })
      expect(await fixture.service.inspect()).toMatchObject({ state: 'installed', managed: true })

      expect(await fixture.service.uninstall()).toMatchObject({ state: 'missing', managed: false })
      expect(fixture.value).toEqual(original)
      expect(existsSync(fixture.receiptPath)).toBe(false)
    },
  )

  it('tracks a newly created PATH value accurately and can remove it after installation', async () => {
    const fixture = harness(null)

    await fixture.service.install()
    expect(JSON.parse(readFileSync(fixture.receiptPath, 'utf8')).windows).toEqual({
      insertedSeparator: false, pathValueCreated: true,
    })
    await fixture.service.uninstall()

    expect(fixture.value).toBeNull()
    expect(fixture.adapter.remove).toHaveBeenCalledOnce()
  })

  it('does not delete duplicate pre-existing PATH entries using a legacy receipt', async () => {
    const fixture = harness(null)
    fixture.value = { type: 'REG_SZ', value: `${fixture.directory};${fixture.directory}` }

    expect(await fixture.service.inspect()).toMatchObject({ state: 'installed', managed: false })
    await expect(fixture.service.uninstall()).rejects.toMatchObject({ code: 'launcher_conflict' })

    expect(fixture.adapter.write).not.toHaveBeenCalled()
    expect(fixture.adapter.remove).not.toHaveBeenCalled()
  })

  it.each([
    ['different installation', { launcherPath: 'C:\\Other\\PiPilot\\pipilot-mcp.exe' }],
    ['different platform', { platform: 'darwin' }],
    ['unknown version', { version: 3 }],
    ['missing v2 ownership metadata', { version: 2 }],
    ['relative target', { launcherPath: 'PiPilot\\pipilot-mcp.exe' }],
    ['malformed fingerprint', { fingerprint: 'not-a-sha256-fingerprint' }],
    ['missing fingerprint', { fingerprint: undefined }],
    ['extra field', { unexpected: true }],
    ['invented v1 ownership metadata', { windows: { insertedSeparator: true, pathValueCreated: false } }],
  ])('keeps a %s receipt blocked without touching PATH', async (_description, mutation) => {
    const fixture = harness({ type: 'REG_SZ', value: 'C:\\Tools' })
    fixture.writeReceipt({ ...fixture.legacy, ...mutation })
    const receiptBefore = readFileSync(fixture.receiptPath, 'utf8')

    expect(await fixture.service.inspect()).toMatchObject({
      state: 'unsupported', error: { code: 'launcher_conflict' },
    })
    await expect(fixture.service.install()).rejects.toMatchObject({ code: 'launcher_conflict' })
    await expect(fixture.service.uninstall()).rejects.toMatchObject({ code: 'launcher_conflict' })

    expect(readFileSync(fixture.receiptPath, 'utf8')).toBe(receiptBefore)
    expect(fixture.adapter.read).not.toHaveBeenCalled()
    expect(fixture.adapter.write).not.toHaveBeenCalled()
    expect(fixture.adapter.remove).not.toHaveBeenCalled()
  })

  it('preserves the legacy record and restores PATH if registry verification fails', async () => {
    const original = { type: 'REG_SZ', value: 'C:\\Tools;;' } as const
    const fixture = harness(original)
    const receiptBefore = readFileSync(fixture.receiptPath, 'utf8')
    vi.mocked(fixture.adapter.read)
      .mockReturnValueOnce(original)
      .mockReturnValueOnce(original)
      .mockReturnValueOnce({ type: 'REG_SZ', value: 'C:\\unexpected' })

    await expect(fixture.service.install()).rejects.toMatchObject({ code: 'launcher_install_failed' })

    expect(fixture.value).toEqual(original)
    expect(readFileSync(fixture.receiptPath, 'utf8')).toBe(receiptBefore)
  })

  it('preserves the legacy record and restores PATH if the atomic receipt replacement fails', async () => {
    const original = { type: 'REG_SZ', value: 'C:\\Tools;;' } as const
    const fixture = harness(original)
    const receiptBefore = readFileSync(fixture.receiptPath, 'utf8')
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw new Error('Simulated atomic receipt replacement failure.')
    })

    await expect(fixture.service.install()).rejects.toMatchObject({ code: 'launcher_install_failed' })

    expect(fixture.value).toEqual(original)
    expect(readFileSync(fixture.receiptPath, 'utf8')).toBe(receiptBefore)
  })

  it('does not replace a legacy receipt changed during installation and rolls back its PATH edit', async () => {
    const original = { type: 'REG_SZ', value: 'C:\\Tools' } as const
    const fixture = harness(original)
    const externalReceipt = { ...fixture.legacy, fingerprint: 'a'.repeat(64) }
    vi.mocked(fixture.adapter.write).mockImplementationOnce((next) => {
      fixture.value = next
      fixture.writeReceipt(externalReceipt)
    })

    await expect(fixture.service.install()).rejects.toMatchObject({ code: 'launcher_conflict' })

    expect(fixture.value).toEqual(original)
    expect(JSON.parse(readFileSync(fixture.receiptPath, 'utf8'))).toEqual(externalReceipt)
  })
})
