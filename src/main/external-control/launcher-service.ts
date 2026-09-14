import { createHash, randomUUID } from 'node:crypto'
import {
  accessSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { dirname, isAbsolute, resolve, win32 } from 'node:path'
import {
  externalControlLauncherSnapshotSchema,
  type ExternalControlLauncherError,
  type ExternalControlLauncherSnapshot,
} from '../../shared/external-control'
import { ExternalControlLauncherServiceError } from './launcher-error'
import {
  assertValidDarwinPathValue,
  createDarwinUserPathAdapter,
  createWindowsUserPathAdapter,
  MAX_DARWIN_ENVIRONMENT_BYTES,
  type DarwinUserPathAdapter,
  type WindowsUserPathAdapter,
  type WindowsUserPathValue,
} from './launcher-platform-adapters'

export { ExternalControlLauncherServiceError } from './launcher-error'
export {
  createDarwinUserPathAdapter,
  createWindowsUserPathAdapter,
  parseWindowsUserPathRegistryExport,
  renderWindowsUserPathRegistryImport,
  type DarwinUserPathAdapter,
  type WindowsUserPathAdapter,
  type WindowsUserPathValue,
} from './launcher-platform-adapters'

const LAUNCHER_NAME = 'pipilot-mcp'
const WINDOWS_LAUNCHER_NAME = 'pipilot-mcp.exe'
const WRAPPER_HEADER = '#!/bin/sh\n# PiPilot MCP launcher v1\n'
const MAX_WRAPPER_BYTES = 64 * 1024
const MAX_RECEIPT_BYTES = 16 * 1024
const MAX_WINDOWS_ENVIRONMENT_CHARS = 32_767
const POSIX_PATH_DELIMITER = ':'

export interface ExternalControlLauncherServiceOptions {
  descriptorPath: string
  executablePath: string | null
  homeDirectory: string
  isPackaged: boolean
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  receiptPath: string
  testTargetDirectory?: string
  uid?: number
  darwinPrivateTargetDirectory?: string
  darwinUserPath?: DarwinUserPathAdapter
  windowsUserPath?: WindowsUserPathAdapter
}

interface FileIdentity {
  contents: string
  dev: number
  ino: number
  mode: number
  mtimeMs: number
  size: number
}

interface LauncherReceipt {
  version: 2
  platform: NodeJS.Platform
  launcherPath: string
  fingerprint: string
  darwin?: DarwinLauncherReceiptMetadata
  windows?: {
    insertedSeparator: boolean
    pathValueCreated: boolean
  }
}

type ReceiptRead =
  | { state: 'missing' }
  | { state: 'invalid' }
  | { state: 'valid'; identity: FileIdentity; receipt: LauncherReceipt }

interface Inspection {
  snapshot: ExternalControlLauncherSnapshot
  targetPath?: string
  wrapper?: string
  targetIdentity?: FileIdentity
  receipt?: ReceiptRead
  windowsPath?: WindowsUserPathValue | null
  darwinPath?: string | null
  darwinPathNeedsRegistration?: boolean
  darwinReceiptNeedsMetadata?: boolean
}

function unsupported(
  code: ExternalControlLauncherError['code'],
  message: string,
) {
  return externalControlLauncherSnapshotSchema.parse({
    state: 'unsupported',
    managed: false,
    requiresClientRestart: false,
    error: { code, message },
  })
}

function fingerprint(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function noFollowFlag() {
  return constants.O_NOFOLLOW ?? 0
}

function readNoFollow(
  path: string,
  maximumBytes: number,
  options: { uid?: number; privateFile?: boolean; writableByOwnerOnly?: boolean } = {},
): FileIdentity {
  const descriptor = openSync(path, constants.O_RDONLY | noFollowFlag())
  try {
    const details = fstatSync(descriptor)
    if (!details.isFile() || details.size > maximumBytes) {
      throw new Error('Unexpected file type or size.')
    }
    if (options.uid !== undefined && details.uid !== options.uid) {
      throw new Error('Unexpected file owner.')
    }
    if (options.privateFile && (details.mode & 0o077) !== 0) {
      throw new Error('File permissions are not private.')
    }
    if (options.writableByOwnerOnly && (details.mode & 0o022) !== 0) {
      throw new Error('File is writable by another principal.')
    }
    const bytes = Buffer.alloc(details.size)
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (count === 0) break
      offset += count
    }
    if (offset !== bytes.length) throw new Error('File changed while being read.')
    return {
      contents: bytes.toString('utf8'),
      dev: details.dev,
      ino: details.ino,
      mode: details.mode,
      mtimeMs: details.mtimeMs,
      size: details.size,
    }
  } finally {
    closeSync(descriptor)
  }
}

function sameIdentity(left: FileIdentity, right: FileIdentity) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.contents === right.contents
}

function writeAtomic(
  path: string,
  contents: string,
  mode: number,
  createParent: boolean,
) {
  const parent = dirname(path)
  if (createParent) mkdirSync(parent, { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  let descriptor: number | null = null
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        noFollowFlag(),
      mode,
    )
    const bytes = Buffer.from(contents, 'utf8')
    let offset = 0
    while (offset < bytes.length) {
      offset += writeSync(descriptor, bytes, offset, bytes.length - offset, offset)
    }
    fchmodSync(descriptor, mode)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    renameSync(temporaryPath, path)
  } catch (error) {
    if (descriptor !== null) {
      try { closeSync(descriptor) } catch { /* already closed */ }
    }
    try { unlinkSync(temporaryPath) } catch { /* no temporary file */ }
    throw error
  }
}

function writeExclusive(path: string, contents: string, mode: number) {
  const descriptor = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
    mode,
  )
  try {
    const bytes = Buffer.from(contents, 'utf8')
    let offset = 0
    while (offset < bytes.length) {
      offset += writeSync(descriptor, bytes, offset, bytes.length - offset, offset)
    }
    fchmodSync(descriptor, mode)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function shellQuote(value: string) {
  return `'${value.split("'").join(`'\"'\"'`)}'`
}

export function renderExternalControlLauncherWrapper(
  executablePath: string,
  descriptorPath: string,
) {
  if (
    !isAbsolute(executablePath) ||
    !isAbsolute(descriptorPath) ||
    /[\0\r\n]/u.test(executablePath) ||
    /[\0\r\n]/u.test(descriptorPath)
  ) {
    throw new ExternalControlLauncherServiceError(
      'launcher_unavailable',
      'The packaged PiPilot launcher source is invalid.',
    )
  }
  return [
    WRAPPER_HEADER.trimEnd(),
    'if [ "$#" -ne 0 ]; then',
    "  printf '%s\\n' '[PiPilot MCP] This launcher does not accept arguments.' >&2",
    '  exit 1',
    'fi',
    `exec ${shellQuote(executablePath)} --pipilot-mcp-stdio --descriptor ${shellQuote(descriptorPath)}`,
    '',
  ].join('\n')
}

function normalizeWindowsPathEntry(value: string) {
  return value.trim().replace(/[\\/]+$/u, '').toLocaleLowerCase('en-US')
}

export function mergeWindowsUserPath(currentValue: string, directory: string) {
  if (!directory || directory.includes('\0') || !win32.isAbsolute(directory)) {
    throw new ExternalControlLauncherServiceError(
      'launcher_unsafe_target',
      'The packaged PiPilot launcher directory is invalid.',
    )
  }
  const normalizedDirectory = normalizeWindowsPathEntry(directory)
  const exists = currentValue
    .split(';')
    .some((entry) => normalizeWindowsPathEntry(entry) === normalizedDirectory)
  if (exists) return { changed: false, value: currentValue }
  const separator = !currentValue || currentValue.endsWith(';') ? '' : ';'
  const value = `${currentValue}${separator}${directory}`
  if (value.length > MAX_WINDOWS_ENVIRONMENT_CHARS) {
    throw new ExternalControlLauncherServiceError(
      'launcher_install_failed',
      'The current-user PATH is too large to update safely.',
    )
  }
  return { changed: true, value }
}

export interface WindowsLauncherReceiptMetadata {
  insertedSeparator: boolean
  pathValueCreated: boolean
}

function matchingWindowsPathEntries(currentValue: string, directory: string) {
  const normalizedDirectory = normalizeWindowsPathEntry(directory)
  const matches: Array<{ end: number; start: number }> = []
  let start = 0
  for (let index = 0; index <= currentValue.length; index += 1) {
    if (index !== currentValue.length && currentValue[index] !== ';') continue
    if (normalizeWindowsPathEntry(currentValue.slice(start, index)) === normalizedDirectory) {
      matches.push({ start, end: index })
    }
    start = index + 1
  }
  return matches
}

export function removeWindowsLauncherDirectory(
  currentValue: string,
  directory: string,
  metadata: WindowsLauncherReceiptMetadata,
) {
  if (!directory || directory.includes('\0') || !win32.isAbsolute(directory)) {
    throw new ExternalControlLauncherServiceError(
      'launcher_unsafe_target',
      'The packaged PiPilot launcher directory is invalid.',
    )
  }
  const matches = matchingWindowsPathEntries(currentValue, directory)
  if (matches.length === 0) return { changed: false, value: currentValue }
  if (matches.length !== 1) {
    throw new ExternalControlLauncherServiceError(
      'launcher_conflict',
      'The current-user PATH contains ambiguous PiPilot launcher entries.',
    )
  }
  const match = matches[0]!
  let removeStart = match.start
  if (metadata.insertedSeparator) {
    if (removeStart === 0 || currentValue[removeStart - 1] !== ';') {
      throw new ExternalControlLauncherServiceError(
        'launcher_conflict',
        'The managed PiPilot launcher PATH entry changed unexpectedly.',
      )
    }
    removeStart -= 1
  }
  return {
    changed: true,
    value: currentValue.slice(0, removeStart) + currentValue.slice(match.end),
  }
}

export async function persistWindowsLauncherDirectory(
  adapter: WindowsUserPathAdapter,
  directory: string,
  afterPersist: (
    value: WindowsUserPathValue,
    metadata: WindowsLauncherReceiptMetadata,
  ) => void | Promise<void> = () => undefined,
) {
  const original = await adapter.read()
  const merged = mergeWindowsUserPath(original?.value ?? '', directory)
  if (!merged.changed) return false
  const updated = {
    type: original?.type ?? 'REG_EXPAND_SZ',
    value: merged.value,
  } satisfies WindowsUserPathValue
  try {
    await adapter.write(updated)
    const readBack = await adapter.read()
    if (readBack?.type !== updated.type || readBack.value !== updated.value) {
      throw new Error('The current-user PATH update did not persist exactly.')
    }
    await afterPersist(updated, {
      insertedSeparator: Boolean(original?.value) && !original!.value.endsWith(';'),
      pathValueCreated: original === null,
    })
  } catch (error) {
    try {
      if (original) await adapter.write(original)
      else await adapter.remove()
    } catch { /* rollback best effort */ }
    throw error
  }
  return true
}

export async function persistWindowsLauncherDirectoryRemoval(
  adapter: WindowsUserPathAdapter,
  directory: string,
  metadata: WindowsLauncherReceiptMetadata,
  afterPersist: () => void | Promise<void> = () => undefined,
) {
  const original = await adapter.read()
  const removed = removeWindowsLauncherDirectory(original?.value ?? '', directory, metadata)
  if (!removed.changed) {
    await afterPersist()
    return false
  }
  const shouldRemoveValue = metadata.pathValueCreated && removed.value === ''
  const updated = original
    ? { type: original.type, value: removed.value } satisfies WindowsUserPathValue
    : null
  try {
    if (shouldRemoveValue) await adapter.remove()
    else if (updated) await adapter.write(updated)
    else throw new Error('The current-user PATH value disappeared before removal.')
    const readBack = await adapter.read()
    if (shouldRemoveValue) {
      if (readBack !== null) {
        throw new Error('The current-user PATH removal did not persist exactly.')
      }
    } else if (
      !updated ||
      !readBack ||
      readBack.type !== updated.type ||
      readBack.value !== updated.value
    ) {
      throw new Error('The current-user PATH update did not persist exactly.')
    }
    await afterPersist()
  } catch (error) {
    try {
      if (original) await adapter.write(original)
      else await adapter.remove()
      const restored = await adapter.read()
      if (original) {
        if (
          !restored ||
          restored.type !== original.type ||
          restored.value !== original.value
        ) {
          throw new Error('The current-user PATH rollback did not persist exactly.')
        }
      } else if (restored !== null) {
        throw new Error('The current-user PATH rollback did not persist exactly.')
      }
    } catch {
      throw new Error('The current-user PATH rollback did not persist exactly.')
    }
    throw error
  }
  return true
}

export interface DarwinLauncherReceiptMetadata {
  insertedSeparator: boolean
  pathEntryAdded: boolean
  pathValueCreated: boolean
  registeredPathFingerprint: string
}

function normalizePosixPathEntry(value: string) {
  return resolve(value)
}

function matchingDarwinPathEntries(currentValue: string, directory: string) {
  const normalizedDirectory = normalizePosixPathEntry(directory)
  const matches: Array<{ end: number; start: number }> = []
  let start = 0
  for (let index = 0; index <= currentValue.length; index += 1) {
    if (index !== currentValue.length && currentValue[index] !== POSIX_PATH_DELIMITER) continue
    const entry = currentValue.slice(start, index)
    if (
      entry &&
      isAbsolute(entry) &&
      normalizePosixPathEntry(entry) === normalizedDirectory
    ) {
      matches.push({ start, end: index })
    }
    start = index + 1
  }
  return matches
}

export function mergeDarwinUserPath(
  currentValue: string | null,
  fallbackValue: string | undefined,
  directory: string,
) {
  if (
    !directory ||
    /[\0\r\n:]/u.test(directory) ||
    !isAbsolute(directory)
  ) {
    throw new ExternalControlLauncherServiceError(
      'launcher_unsafe_target',
      'The packaged PiPilot launcher directory is invalid.',
    )
  }
  const baseValue = currentValue ?? fallbackValue
  if (baseValue === undefined) {
    throw new ExternalControlLauncherServiceError(
      'launcher_unsafe_target',
      'The current-user PATH is unavailable.',
    )
  }
  assertValidDarwinPathValue(baseValue)
  const firstEntry = baseValue.split(POSIX_PATH_DELIMITER, 1)[0]!
  const pathEntryAdded = !isAbsolute(firstEntry) ||
    normalizePosixPathEntry(firstEntry) !== normalizePosixPathEntry(directory)
  const insertedSeparator = pathEntryAdded
  const value = pathEntryAdded
    ? `${directory}${POSIX_PATH_DELIMITER}${baseValue}`
    : baseValue
  if (Buffer.byteLength(value, 'utf8') > MAX_DARWIN_ENVIRONMENT_BYTES) {
    throw new ExternalControlLauncherServiceError(
      'launcher_install_failed',
      'The current-user PATH is too large to update safely.',
    )
  }
  return {
    changed: currentValue === null || pathEntryAdded,
    metadata: {
      insertedSeparator,
      pathEntryAdded,
      pathValueCreated: currentValue === null,
      registeredPathFingerprint: fingerprint(value),
    } satisfies DarwinLauncherReceiptMetadata,
    value,
  }
}

export function removeDarwinLauncherDirectory(
  currentValue: string | null,
  directory: string,
  metadata: DarwinLauncherReceiptMetadata,
) {
  if (
    !directory ||
    /[\0\r\n:]/u.test(directory) ||
    !isAbsolute(directory) ||
    !/^[a-f0-9]{64}$/u.test(metadata.registeredPathFingerprint)
  ) {
    throw new ExternalControlLauncherServiceError(
      'launcher_unsafe_target',
      'The packaged PiPilot launcher PATH receipt is invalid.',
    )
  }
  if (currentValue === null) return { changed: false, value: null }
  assertValidDarwinPathValue(currentValue)
  if (
    metadata.pathValueCreated &&
    fingerprint(currentValue) === metadata.registeredPathFingerprint
  ) {
    return { changed: true, value: null }
  }
  if (!metadata.pathEntryAdded) return { changed: false, value: currentValue }
  const matches = matchingDarwinPathEntries(currentValue, directory)
  const match = matches[0]
  if (!match) return { changed: false, value: currentValue }
  if (match.start !== 0) {
    throw new ExternalControlLauncherServiceError(
      'launcher_conflict',
      'The managed PiPilot launcher is no longer the first PATH entry.',
    )
  }
  if (metadata.insertedSeparator) {
    if (currentValue[match.end] !== POSIX_PATH_DELIMITER) {
      throw new ExternalControlLauncherServiceError(
        'launcher_conflict',
        'The managed PiPilot launcher PATH entry changed unexpectedly.',
      )
    }
  }
  return {
    changed: true,
    value: currentValue.slice(match.end + (metadata.insertedSeparator ? 1 : 0)),
  }
}

async function restoreDarwinUserPath(adapter: DarwinUserPathAdapter, original: string | null) {
  if (original === null) await adapter.remove()
  else await adapter.write(original)
  if (await adapter.read() !== original) {
    throw new Error('The current-user PATH rollback did not persist exactly.')
  }
}

export async function persistDarwinLauncherDirectory(
  adapter: DarwinUserPathAdapter,
  fallbackValue: string | undefined,
  directory: string,
  afterPersist: (metadata: DarwinLauncherReceiptMetadata) => void | Promise<void> = () => undefined,
) {
  const original = await adapter.read()
  const merged = mergeDarwinUserPath(original, fallbackValue, directory)
  try {
    if (merged.changed) {
      await adapter.write(merged.value)
      if (await adapter.read() !== merged.value) {
        throw new Error('The current-user PATH update did not persist exactly.')
      }
    }
    await afterPersist(merged.metadata)
  } catch (error) {
    if (merged.changed) {
      try {
        await restoreDarwinUserPath(adapter, original)
      } catch {
        throw new Error('The current-user PATH rollback did not persist exactly.')
      }
    }
    throw error
  }
  return merged.changed
}

export async function persistDarwinLauncherDirectoryRemoval(
  adapter: DarwinUserPathAdapter,
  directory: string,
  metadata: DarwinLauncherReceiptMetadata,
  afterPersist: () => void | Promise<void> = () => undefined,
) {
  const original = await adapter.read()
  const removed = removeDarwinLauncherDirectory(original, directory, metadata)
  try {
    if (removed.changed) {
      if (removed.value === null) await adapter.remove()
      else await adapter.write(removed.value)
      if (await adapter.read() !== removed.value) {
        throw new Error('The current-user PATH removal did not persist exactly.')
      }
    }
    await afterPersist()
  } catch (error) {
    if (removed.changed) {
      try {
        await restoreDarwinUserPath(adapter, original)
      } catch {
        throw new Error('The current-user PATH rollback did not persist exactly.')
      }
    }
    throw error
  }
  return removed.changed
}

export function isSafePosixResolutionDirectoryOwner(
  directoryUid: number,
  currentUid: number,
) {
  return directoryUid === 0 || directoryUid === currentUid
}

export class ExternalControlLauncherService {
  private readonly platform: NodeJS.Platform
  private readonly environment: NodeJS.ProcessEnv
  private readonly uid: number | undefined
  private readonly darwinUserPath: DarwinUserPathAdapter | null
  private readonly windowsUserPath: WindowsUserPathAdapter | null
  private requiresClientRestart = false
  private pendingOperation: Promise<void> = Promise.resolve()
  private pendingInspection: Promise<ExternalControlLauncherSnapshot> | null = null

  constructor(private readonly options: ExternalControlLauncherServiceOptions) {
    this.platform = options.platform ?? process.platform
    this.environment = options.environment ?? process.env
    this.uid = options.uid ?? process.getuid?.()
    if (options.darwinUserPath) {
      this.darwinUserPath = options.darwinUserPath
    } else if (
      this.platform === 'darwin' &&
      options.darwinPrivateTargetDirectory &&
      !options.testTargetDirectory
    ) {
      try {
        this.darwinUserPath = createDarwinUserPathAdapter()
      } catch {
        this.darwinUserPath = null
      }
    } else {
      this.darwinUserPath = null
    }
    if (options.windowsUserPath) {
      this.windowsUserPath = options.windowsUserPath
    } else if (this.platform === 'win32') {
      try {
        this.windowsUserPath = createWindowsUserPathAdapter(
          this.environment,
          win32.dirname(this.options.receiptPath),
        )
      } catch {
        this.windowsUserPath = null
      }
    } else {
      this.windowsUserPath = null
    }
  }

  inspect() {
    if (this.pendingInspection) return this.pendingInspection
    const inspection = this.enqueue(() => this.inspectSnapshot())
    this.pendingInspection = inspection
    const clear = () => {
      if (this.pendingInspection === inspection) this.pendingInspection = null
    }
    void inspection.then(clear, clear)
    return inspection
  }

  initialize() {
    this.pendingInspection = null
    return this.enqueue(() => this.initializeInternal())
  }

  install() {
    this.pendingInspection = null
    return this.enqueue(() => this.installInternal())
  }

  uninstall() {
    this.pendingInspection = null
    return this.enqueue(() => this.uninstallInternal())
  }

  /** Reads and mutations share a lane so inspection never observes a half-written receipt/PATH. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pendingOperation.then(operation)
    this.pendingOperation = result.then(() => undefined, () => undefined)
    return result
  }

  private async inspectSnapshot() {
    const snapshot = (await this.inspectInternal()).snapshot
    return structuredClone(this.withRestartState(snapshot))
  }

  private async initializeInternal() {
    if (
      this.platform !== 'darwin' ||
      !this.options.darwinPrivateTargetDirectory ||
      this.options.testTargetDirectory
    ) return this.inspectSnapshot()
    const inspection = await this.inspectInternal()
    if (
      inspection.snapshot.state !== 'repair' ||
      !inspection.targetPath ||
      !inspection.wrapper ||
      !inspection.targetIdentity ||
      inspection.receipt?.state !== 'valid' ||
      inspection.targetIdentity.contents !== inspection.wrapper ||
      (inspection.targetIdentity.mode & 0o100) === 0 ||
      (!inspection.darwinPathNeedsRegistration && !inspection.darwinReceiptNeedsMetadata)
    ) return structuredClone(this.withRestartState(inspection.snapshot))
    try {
      const changed = await persistDarwinLauncherDirectory(
        this.darwinUserPath!,
        this.environment.PATH,
        dirname(inspection.targetPath),
        async (metadata) => {
          this.writeReceipt(
            inspection.targetPath!,
            inspection.wrapper!,
            undefined,
            metadata,
          )
          if ((await this.inspectDarwin()).snapshot.state !== 'installed') {
            throw new Error('The recovered PiPilot MCP launcher could not be verified.')
          }
        },
      )
      this.requiresClientRestart ||= changed
    } catch {
      // Recovery is best effort; Settings exposes the remaining repair state.
    }
    return this.inspectSnapshot()
  }

  private async installInternal() {
    const inspection = await this.inspectInternal()
    if (inspection.snapshot.state === 'installed') return inspection.snapshot
    if (inspection.snapshot.state === 'unsupported' || !inspection.targetPath) {
      const error = inspection.snapshot.error
      throw new ExternalControlLauncherServiceError(
        error?.code ?? 'launcher_unavailable',
        error?.message ?? 'The PiPilot MCP launcher cannot be installed safely.',
      )
    }
    try {
      if (this.platform === 'win32') return await this.installWindows(inspection)
      if (this.platform === 'darwin' && this.options.darwinPrivateTargetDirectory) {
        return await this.installDarwin(inspection)
      }
      return await this.installPosix(inspection)
    } catch (error) {
      if (error instanceof ExternalControlLauncherServiceError) throw error
      throw new ExternalControlLauncherServiceError(
        'launcher_install_failed',
        'The PiPilot MCP launcher could not be installed.',
      )
    }
  }

  private async uninstallInternal() {
    const receipt = this.readReceipt()
    if (receipt.state === 'invalid') {
      throw new ExternalControlLauncherServiceError(
        'launcher_conflict',
        'The existing PiPilot MCP launcher receipt is invalid.',
      )
    }
    if (receipt.state === 'missing') {
      const inspection = await this.inspectInternal()
      if (inspection.snapshot.state === 'missing') return inspection.snapshot
      throw new ExternalControlLauncherServiceError(
        'launcher_conflict',
        'The pipilot-mcp command is not managed by PiPilot.',
      )
    }
    try {
      if (this.platform === 'win32') return await this.uninstallWindows(receipt)
      if (
        this.platform === 'darwin' &&
        this.options.darwinPrivateTargetDirectory &&
        receipt.receipt.darwin
      ) return await this.uninstallDarwin(receipt)
      return this.uninstallPosix(receipt)
    } catch (error) {
      if (error instanceof ExternalControlLauncherServiceError) throw error
      throw new ExternalControlLauncherServiceError(
        'launcher_uninstall_failed',
        'The PiPilot MCP launcher could not be uninstalled.',
      )
    }
  }

  private async inspectInternal(): Promise<Inspection> {
    if (!this.options.isPackaged && !this.options.testTargetDirectory) {
      return { snapshot: unsupported(
        'launcher_unavailable',
        'The stable MCP launcher is available only in a packaged PiPilot build.',
      ) }
    }
    const absolute = this.platform === 'win32' ? win32.isAbsolute : isAbsolute
    if (
      !this.options.executablePath ||
      /[\0\r\n]/u.test(this.options.executablePath) ||
      /[\0\r\n]/u.test(this.options.descriptorPath) ||
      /[\0\r\n]/u.test(this.options.receiptPath) ||
      !absolute(this.options.executablePath) ||
      !absolute(this.options.descriptorPath) ||
      !absolute(this.options.receiptPath)
    ) {
      return { snapshot: unsupported(
        'launcher_unavailable',
        'The packaged PiPilot MCP launcher is unavailable.',
      ) }
    }
    try {
      const source = lstatSync(this.options.executablePath)
      if (source.isSymbolicLink() || !source.isFile()) throw new Error('Invalid source.')
    } catch {
      return { snapshot: unsupported(
        'launcher_unavailable',
        'The packaged PiPilot MCP launcher is unavailable.',
      ) }
    }
    if (this.platform === 'win32') return this.inspectWindows()
    if (this.platform !== 'darwin' && this.platform !== 'linux') {
      return { snapshot: unsupported(
        'launcher_unavailable',
        'The stable MCP launcher is unsupported on this platform.',
      ) }
    }
    if (this.platform === 'darwin' && this.options.darwinPrivateTargetDirectory) {
      return this.inspectDarwin()
    }
    return this.inspectPosix()
  }

  private withRestartState(snapshot: ExternalControlLauncherSnapshot) {
    if (!this.requiresClientRestart || snapshot.requiresClientRestart) return snapshot
    return externalControlLauncherSnapshotSchema.parse({
      ...snapshot,
      requiresClientRestart: true,
    })
  }

  private async inspectWindows(): Promise<Inspection> {
    const targetPath = this.options.executablePath!
    if (
      !this.windowsUserPath ||
      win32.basename(targetPath).toLocaleLowerCase('en-US') !== WINDOWS_LAUNCHER_NAME
    ) {
      return { snapshot: unsupported(
        'launcher_unavailable',
        'The packaged Windows MCP launcher is unavailable.',
      ) }
    }
    try {
      const receipt = this.readReceipt()
      if (receipt.state === 'invalid') {
        return { snapshot: unsupported(
          'launcher_conflict',
          'The existing PiPilot MCP launcher receipt is invalid.',
        ) }
      }
      const directory = win32.dirname(targetPath)
      const owned = receipt.state === 'valid' && this.windowsReceiptMatches(
        receipt.receipt,
        targetPath,
      )
      if (receipt.state === 'valid' && !owned) {
        return { snapshot: unsupported(
          'launcher_conflict',
          'The existing PiPilot MCP launcher receipt belongs to another installation.',
        ) }
      }
      const windowsPath = await this.windowsUserPath.read()
      const merged = mergeWindowsUserPath(
        windowsPath?.value ?? '',
        directory,
      )
      const unambiguous = matchingWindowsPathEntries(
        windowsPath?.value ?? '',
        directory,
      ).length === 1
      return {
        targetPath,
        windowsPath,
        receipt,
        snapshot: externalControlLauncherSnapshotSchema.parse({
          state: merged.changed ? 'missing' : 'installed',
          managed: !merged.changed && owned && unambiguous,
          requiresClientRestart: false,
        }),
      }
    } catch {
      return { snapshot: unsupported(
        'launcher_unavailable',
        'The current-user PATH could not be inspected.',
      ) }
    }
  }

  private async inspectDarwin(): Promise<Inspection> {
    const targetDirectory = this.options.darwinPrivateTargetDirectory
    if (
      this.uid === undefined ||
      !this.darwinUserPath ||
      !targetDirectory ||
      !isAbsolute(targetDirectory) ||
      /[\0\r\n:]/u.test(targetDirectory) ||
      resolve(targetDirectory) !== targetDirectory ||
      dirname(targetDirectory) === targetDirectory ||
      !this.isInstallableDirectory(targetDirectory) ||
      !this.isResolutionSafe(targetDirectory)
    ) {
      return { snapshot: unsupported(
        'launcher_unsafe_target',
        'The private macOS launcher directory is unavailable or unsafe.',
      ) }
    }
    let wrapper: string
    try {
      wrapper = renderExternalControlLauncherWrapper(
        this.options.executablePath!,
        this.options.descriptorPath,
      )
    } catch (error) {
      return { snapshot: unsupported(
        'launcher_unavailable',
        error instanceof Error ? error.message : 'The launcher source is invalid.',
      ) }
    }
    const receipt = this.readReceipt()
    if (receipt.state === 'invalid') {
      return { snapshot: unsupported(
        'launcher_conflict',
        'The existing PiPilot MCP launcher receipt is invalid.',
      ) }
    }
    const targetPath = resolve(targetDirectory, LAUNCHER_NAME)
    if (
      receipt.state === 'valid' &&
      resolve(receipt.receipt.launcherPath) !== targetPath
    ) {
      return { snapshot: unsupported(
        'launcher_conflict',
        'The existing PiPilot MCP launcher receipt belongs to another target.',
      ) }
    }
    let darwinPath: string | null
    let pathValue: string
    try {
      darwinPath = await this.darwinUserPath.read()
      pathValue = darwinPath ?? this.environment.PATH ?? ''
      assertValidDarwinPathValue(pathValue)
    } catch {
      return { snapshot: unsupported(
        'launcher_unavailable',
        'The current-user macOS PATH could not be inspected.',
      ) }
    }
    const firstDirectory = pathValue.split(POSIX_PATH_DELIMITER, 1)[0]!
    const targetIsFirst = isAbsolute(firstDirectory) &&
      normalizePosixPathEntry(firstDirectory) === targetDirectory
    let inspected: Inspection
    try {
      lstatSync(targetPath)
      inspected = this.inspectExistingPosix(targetPath, wrapper, receipt)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { snapshot: unsupported(
          'launcher_conflict',
          'The private pipilot-mcp command could not be inspected safely.',
        ) }
      }
      inspected = {
        targetPath,
        wrapper,
        receipt,
        snapshot: externalControlLauncherSnapshotSchema.parse({
          state: 'missing',
          managed: false,
          requiresClientRestart: false,
        }),
      }
    }
    if (inspected.snapshot.state === 'unsupported') return inspected
    const receiptNeedsMetadata = receipt.state === 'valid' && !receipt.receipt.darwin
    const pathNeedsRegistration = darwinPath === null || !targetIsFirst
    const state = inspected.snapshot.state === 'installed' &&
      (pathNeedsRegistration || receiptNeedsMetadata)
      ? 'repair'
      : inspected.snapshot.state
    return {
      ...inspected,
      darwinPath,
      darwinPathNeedsRegistration: pathNeedsRegistration,
      darwinReceiptNeedsMetadata: receiptNeedsMetadata,
      snapshot: externalControlLauncherSnapshotSchema.parse({
        ...inspected.snapshot,
        state,
      }),
    }
  }

  private inspectPosix(): Inspection {
    if (this.uid === undefined || !isAbsolute(this.options.homeDirectory)) {
      return { snapshot: unsupported(
        'launcher_unavailable',
        'The current-user launcher boundary is unavailable.',
      ) }
    }
    let wrapper: string
    try {
      wrapper = renderExternalControlLauncherWrapper(
        this.options.executablePath!,
        this.options.descriptorPath,
      )
    } catch (error) {
      return { snapshot: unsupported(
        'launcher_unavailable',
        error instanceof Error ? error.message : 'The launcher source is invalid.',
      ) }
    }
    const receipt = this.readReceipt()
    if (receipt.state === 'invalid') {
      return { snapshot: unsupported(
        'launcher_conflict',
        'The existing PiPilot MCP launcher receipt is invalid.',
      ) }
    }
    const pathValue = this.options.testTargetDirectory
      ? this.options.testTargetDirectory
      : this.environment.PATH
    if (!pathValue || pathValue.includes('\0')) {
      return { snapshot: unsupported(
        'launcher_unsafe_target',
        'No secure user-writable launcher directory is available in PATH.',
      ) }
    }
    const stableTargets = new Set<string>()
    if (receipt.state === 'valid') stableTargets.add(resolve(receipt.receipt.launcherPath))
    if (this.options.testTargetDirectory) {
      stableTargets.add(resolve(this.options.testTargetDirectory, LAUNCHER_NAME))
    } else {
      stableTargets.add(resolve(this.options.homeDirectory, '.local', 'bin', LAUNCHER_NAME))
      stableTargets.add(resolve(this.options.homeDirectory, 'bin', LAUNCHER_NAME))
    }

    for (const rawDirectory of pathValue.split(POSIX_PATH_DELIMITER)) {
      if (!rawDirectory || !isAbsolute(rawDirectory) || /[\0\r\n]/u.test(rawDirectory)) {
        return { snapshot: unsupported(
          'launcher_unsafe_target',
          'PATH contains a relative or invalid directory.',
        ) }
      }
      const directory = resolve(rawDirectory)
      const resolutionSafe = this.options.testTargetDirectory
        ? this.isInstallableDirectory(directory)
        : this.isResolutionSafe(directory)
      if (!resolutionSafe) {
        return { snapshot: unsupported(
          'launcher_unsafe_target',
          'A PATH directory before the PiPilot launcher is writable by another principal.',
        ) }
      }
      const targetPath = resolve(directory, LAUNCHER_NAME)
      try {
        lstatSync(targetPath)
        return this.inspectExistingPosix(targetPath, wrapper, receipt)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          return { snapshot: unsupported(
            'launcher_conflict',
            'An existing pipilot-mcp command could not be inspected safely.',
          ) }
        }
      }
      if (stableTargets.has(targetPath) && this.isInstallableDirectory(directory)) {
        return {
          targetPath,
          wrapper,
          receipt,
          snapshot: externalControlLauncherSnapshotSchema.parse({
            state: 'missing',
            managed: false,
            requiresClientRestart: false,
          }),
        }
      }
    }
    return { snapshot: unsupported(
      'launcher_unsafe_target',
      'No secure stable user-writable launcher directory is already present in PATH.',
    ) }
  }

  private inspectExistingPosix(
    targetPath: string,
    wrapper: string,
    receipt: ReceiptRead,
  ): Inspection {
    let targetIdentity: FileIdentity
    try {
      targetIdentity = readNoFollow(targetPath, MAX_WRAPPER_BYTES, {
        uid: this.uid,
        writableByOwnerOnly: true,
      })
    } catch {
      return { snapshot: unsupported(
        'launcher_conflict',
        'An existing pipilot-mcp command is not safely managed by PiPilot.',
      ) }
    }
    const receiptMatches = receipt.state === 'valid' &&
      resolve(receipt.receipt.launcherPath) === targetPath &&
      receipt.receipt.fingerprint === fingerprint(targetIdentity.contents)
    const isExecutable = (targetIdentity.mode & 0o100) !== 0
    if (targetIdentity.contents === wrapper && receipt.state === 'missing') {
      return {
        targetPath,
        wrapper,
        targetIdentity,
        receipt,
        snapshot: externalControlLauncherSnapshotSchema.parse({
          state: 'repair',
          managed: false,
          requiresClientRestart: false,
        }),
      }
    }
    if (!targetIdentity.contents.startsWith(WRAPPER_HEADER) || !receiptMatches) {
      return { snapshot: unsupported(
        'launcher_conflict',
        'An existing pipilot-mcp command is not managed by this PiPilot installation.',
      ) }
    }
    return {
      targetPath,
      wrapper,
      targetIdentity,
      receipt,
      snapshot: externalControlLauncherSnapshotSchema.parse({
        state: targetIdentity.contents === wrapper && isExecutable
          ? 'installed'
          : 'repair',
        managed: true,
        requiresClientRestart: false,
      }),
    }
  }

  private isResolutionSafe(path: string) {
    let current = path
    let isPathDirectory = true
    while (true) {
      try {
        const details = lstatSync(current)
        const writableByAnotherPrincipal = (details.mode & 0o022) !== 0
        const protectedSharedAncestor = !isPathDirectory &&
          (details.mode & 0o1000) !== 0
        const unexpectedPathOwner = isPathDirectory &&
          !isSafePosixResolutionDirectoryOwner(details.uid, this.uid!)
        if (
          details.isSymbolicLink() ||
          !details.isDirectory() ||
          unexpectedPathOwner ||
          (writableByAnotherPrincipal && !protectedSharedAncestor)
        ) return false
      } catch { return false }
      const parent = dirname(current)
      if (parent === current) return true
      current = parent
      isPathDirectory = false
    }
  }

  private isInstallableDirectory(path: string) {
    try {
      const details = lstatSync(path)
      if (
        details.isSymbolicLink() ||
        !details.isDirectory() ||
        details.uid !== this.uid ||
        (details.mode & 0o022) !== 0
      ) return false
      accessSync(path, constants.W_OK | constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  private async installPosix(
    inspection: Inspection,
    darwin?: DarwinLauncherReceiptMetadata,
    inspect: () => Inspection | Promise<Inspection> = () => this.inspectPosix(),
  ) {
    const fresh = await inspect()
    if (
      fresh.snapshot.state !== inspection.snapshot.state ||
      fresh.targetPath !== inspection.targetPath ||
      !fresh.targetPath ||
      !fresh.wrapper
    ) {
      throw new ExternalControlLauncherServiceError(
        'launcher_conflict',
        'The launcher target changed before installation.',
      )
    }
    if (!this.isInstallableDirectory(dirname(fresh.targetPath))) {
      throw new ExternalControlLauncherServiceError(
        'launcher_unsafe_target',
        'The launcher directory is no longer safe or writable.',
      )
    }
    if (fresh.targetIdentity && inspection.targetIdentity) {
      if (!sameIdentity(fresh.targetIdentity, inspection.targetIdentity)) {
        throw new ExternalControlLauncherServiceError(
          'launcher_conflict',
          'The launcher target changed before installation.',
        )
      }
    } else if (fresh.targetIdentity || inspection.targetIdentity) {
      throw new ExternalControlLauncherServiceError(
        'launcher_conflict',
        'The launcher target changed before installation.',
      )
    }
    const receiptOnlyRecovery = fresh.targetIdentity?.contents === fresh.wrapper &&
      (fresh.targetIdentity.mode & 0o100) !== 0 &&
      fresh.receipt?.state === 'missing'
    const previous = fresh.targetIdentity
    if (!receiptOnlyRecovery) writeAtomic(fresh.targetPath, fresh.wrapper, 0o755, false)
    const installedTarget = readNoFollow(fresh.targetPath, MAX_WRAPPER_BYTES, {
      uid: this.uid,
      writableByOwnerOnly: true,
    })
    let installedReceipt: Extract<ReceiptRead, { state: 'valid' }> | null = null
    try {
      this.writeReceipt(fresh.targetPath, fresh.wrapper, undefined, darwin)
      const receipt = this.readReceipt()
      if (receipt.state !== 'valid') throw new Error('The launcher receipt could not be verified.')
      installedReceipt = receipt
      const verified = (await inspect()).snapshot
      if (verified.state !== 'installed') {
        throw new ExternalControlLauncherServiceError(
          'launcher_install_failed',
          'The installed PiPilot MCP launcher could not be verified.',
        )
      }
      return verified
    } catch (error) {
      // Verification now awaits a platform command. Never replace files changed while it ran.
      const currentTarget = readNoFollow(fresh.targetPath, MAX_WRAPPER_BYTES, {
        uid: this.uid,
        writableByOwnerOnly: true,
      })
      if (!sameIdentity(currentTarget, installedTarget)) {
        throw new ExternalControlLauncherServiceError(
          'launcher_conflict',
          'The installed PiPilot MCP launcher changed during verification.',
        )
      }
      if (installedReceipt) {
        const currentReceipt = this.readReceipt()
        if (currentReceipt.state !== 'valid' ||
          !sameIdentity(currentReceipt.identity, installedReceipt.identity)) {
          throw new ExternalControlLauncherServiceError(
            'launcher_conflict',
            'The PiPilot MCP launcher receipt changed during verification.',
          )
        }
        if (fresh.receipt?.state === 'valid') {
          writeAtomic(this.options.receiptPath, fresh.receipt.identity.contents, 0o600, false)
        } else {
          this.removeReceipt(installedReceipt.identity)
        }
      }
      if (!receiptOnlyRecovery) {
        if (previous) {
          writeAtomic(
            fresh.targetPath,
            previous.contents,
            previous.mode & 0o777,
            false,
          )
        }
        else {
          try { unlinkSync(fresh.targetPath) } catch { /* rollback best effort */ }
        }
      }
      throw error
    }
  }

  private async installDarwin(inspection: Inspection) {
    if (!this.darwinUserPath || !inspection.targetPath) {
      throw new ExternalControlLauncherServiceError(
        'launcher_unavailable',
        'The current-user macOS PATH is unavailable.',
      )
    }
    let installed: ExternalControlLauncherSnapshot | null = null
    const changed = await persistDarwinLauncherDirectory(
      this.darwinUserPath,
      this.environment.PATH,
      dirname(inspection.targetPath),
      async (metadata) => {
        const fresh = await this.inspectDarwin()
        // Repairing only the wrapper must retain ownership of the PATH registration.
        const receiptMetadata = !metadata.pathEntryAdded && !metadata.pathValueCreated &&
          fresh.receipt?.state === 'valid' && fresh.receipt.receipt.darwin
          ? fresh.receipt.receipt.darwin
          : metadata
        installed = await this.installPosix(
          fresh,
          receiptMetadata,
          () => this.inspectDarwin(),
        )
      },
    )
    this.requiresClientRestart ||= changed
    return externalControlLauncherSnapshotSchema.parse({
      ...installed!,
      requiresClientRestart: changed,
    })
  }

  private async installWindows(inspection: Inspection) {
    const adapter = this.windowsUserPath!
    const changed = await persistWindowsLauncherDirectory(
      adapter,
      win32.dirname(inspection.targetPath!),
      (_updated, metadata) => this.writeReceipt(
        inspection.targetPath!,
        normalizeWindowsPathEntry(win32.dirname(inspection.targetPath!)),
        metadata,
      ),
    )
    if (!changed) return inspection.snapshot
    return externalControlLauncherSnapshotSchema.parse({
      state: 'installed',
      managed: true,
      requiresClientRestart: true,
    })
  }

  private async uninstallWindows(receipt: Extract<ReceiptRead, { state: 'valid' }>) {
    const targetPath = this.options.executablePath
    if (
      !targetPath ||
      !this.windowsUserPath ||
      !this.windowsReceiptMatches(receipt.receipt, targetPath) ||
      !receipt.receipt.windows
    ) {
      throw new ExternalControlLauncherServiceError(
        'launcher_conflict',
        'The PiPilot MCP launcher receipt does not match this installation.',
      )
    }
    const changed = await persistWindowsLauncherDirectoryRemoval(
      this.windowsUserPath,
      win32.dirname(targetPath),
      receipt.receipt.windows,
      () => this.removeReceipt(receipt.identity),
    )
    return externalControlLauncherSnapshotSchema.parse({
      state: 'missing',
      managed: false,
      requiresClientRestart: changed,
    })
  }

  private async uninstallDarwin(receipt: Extract<ReceiptRead, { state: 'valid' }>) {
    const targetPath = resolve(receipt.receipt.launcherPath)
    const targetDirectory = this.options.darwinPrivateTargetDirectory
    if (
      !this.darwinUserPath ||
      !targetDirectory ||
      targetPath !== resolve(targetDirectory, LAUNCHER_NAME) ||
      !receipt.receipt.darwin
    ) {
      throw new ExternalControlLauncherServiceError(
        'launcher_conflict',
        'The PiPilot MCP launcher receipt does not match this installation.',
      )
    }
    const changed = await persistDarwinLauncherDirectoryRemoval(
      this.darwinUserPath,
      targetDirectory,
      receipt.receipt.darwin,
      () => { this.uninstallPosix(receipt) },
    )
    this.requiresClientRestart ||= changed
    return externalControlLauncherSnapshotSchema.parse({
      state: 'missing',
      managed: false,
      requiresClientRestart: changed,
    })
  }

  private uninstallPosix(receipt: Extract<ReceiptRead, { state: 'valid' }>) {
    if (this.platform !== 'darwin' && this.platform !== 'linux') {
      throw new ExternalControlLauncherServiceError(
        'launcher_unavailable',
        'The stable MCP launcher is unsupported on this platform.',
      )
    }
    const targetPath = resolve(receipt.receipt.launcherPath)
    if (
      targetPath !== receipt.receipt.launcherPath ||
      dirname(targetPath) === targetPath ||
      targetPath.slice(dirname(targetPath).length + 1) !== LAUNCHER_NAME
    ) {
      throw new ExternalControlLauncherServiceError(
        'launcher_conflict',
        'The PiPilot MCP launcher receipt target is invalid.',
      )
    }

    let targetIdentity: FileIdentity
    try {
      targetIdentity = readNoFollow(targetPath, MAX_WRAPPER_BYTES, {
        uid: this.uid,
        writableByOwnerOnly: true,
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.removeReceipt(receipt.identity)
        return externalControlLauncherSnapshotSchema.parse({
          state: 'missing',
          managed: false,
          requiresClientRestart: false,
        })
      }
      throw new ExternalControlLauncherServiceError(
        'launcher_conflict',
        'The managed PiPilot MCP launcher could not be inspected safely.',
      )
    }
    if (
      !targetIdentity.contents.startsWith(WRAPPER_HEADER) ||
      receipt.receipt.fingerprint !== fingerprint(targetIdentity.contents) ||
      !this.isInstallableDirectory(dirname(targetPath))
    ) {
      throw new ExternalControlLauncherServiceError(
        'launcher_conflict',
        'The managed PiPilot MCP launcher changed before removal.',
      )
    }
    const currentReceipt = this.readReceipt()
    const currentTarget = readNoFollow(targetPath, MAX_WRAPPER_BYTES, {
      uid: this.uid,
      writableByOwnerOnly: true,
    })
    if (
      currentReceipt.state !== 'valid' ||
      !sameIdentity(receipt.identity, currentReceipt.identity) ||
      !sameIdentity(targetIdentity, currentTarget)
    ) {
      throw new ExternalControlLauncherServiceError(
        'launcher_conflict',
        'The managed PiPilot MCP launcher changed before removal.',
      )
    }

    unlinkSync(targetPath)
    try {
      this.removeReceipt(receipt.identity)
    } catch (error) {
      try {
        writeExclusive(targetPath, targetIdentity.contents, targetIdentity.mode & 0o777)
      } catch { /* never replace a target recreated during rollback */ }
      throw error
    }
    try {
      lstatSync(targetPath)
      throw new Error('The launcher still exists after removal.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return externalControlLauncherSnapshotSchema.parse({
      state: 'missing',
      managed: false,
      requiresClientRestart: false,
    })
  }

  private windowsReceiptMatches(receipt: LauncherReceipt, targetPath: string) {
    return receipt.platform === 'win32' &&
      receipt.launcherPath.toLocaleLowerCase('en-US') ===
        targetPath.toLocaleLowerCase('en-US') &&
      receipt.fingerprint === fingerprint(normalizeWindowsPathEntry(win32.dirname(targetPath))) &&
      receipt.windows !== undefined
  }

  private readReceipt(): ReceiptRead {
    try {
      const file = readNoFollow(this.options.receiptPath, MAX_RECEIPT_BYTES, {
        uid: this.uid,
        privateFile: this.platform !== 'win32',
      })
      const raw = JSON.parse(file.contents) as Partial<LauncherReceipt>
      const keys = Object.keys(raw).sort()
      const expectedKeys = raw.platform === 'win32'
        ? ['fingerprint', 'launcherPath', 'platform', 'version', 'windows']
        : raw.platform === 'darwin' && raw.darwin !== undefined
          ? ['darwin', 'fingerprint', 'launcherPath', 'platform', 'version']
          : ['fingerprint', 'launcherPath', 'platform', 'version']
      if (
        raw.version !== 2 ||
        raw.platform !== this.platform ||
        JSON.stringify(keys) !== JSON.stringify(expectedKeys) ||
        typeof raw.launcherPath !== 'string' ||
        /[\0\r\n]/u.test(raw.launcherPath) ||
        !(this.platform === 'win32'
          ? win32.isAbsolute(raw.launcherPath)
          : isAbsolute(raw.launcherPath)) ||
        typeof raw.fingerprint !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(raw.fingerprint) ||
        (raw.platform === 'win32' && (
          typeof raw.windows !== 'object' ||
          raw.windows === null ||
          Object.keys(raw.windows).sort().join(',') !== 'insertedSeparator,pathValueCreated' ||
          typeof raw.windows.insertedSeparator !== 'boolean' ||
          typeof raw.windows.pathValueCreated !== 'boolean'
        )) ||
        (raw.platform === 'darwin' && raw.darwin !== undefined && (
          typeof raw.darwin !== 'object' ||
          raw.darwin === null ||
          Object.keys(raw.darwin).sort().join(',') !==
            'insertedSeparator,pathEntryAdded,pathValueCreated,registeredPathFingerprint' ||
          typeof raw.darwin.insertedSeparator !== 'boolean' ||
          typeof raw.darwin.pathEntryAdded !== 'boolean' ||
          raw.darwin.insertedSeparator !== raw.darwin.pathEntryAdded ||
          typeof raw.darwin.pathValueCreated !== 'boolean' ||
          typeof raw.darwin.registeredPathFingerprint !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(raw.darwin.registeredPathFingerprint)
        )) ||
        (raw.platform !== 'win32' && raw.windows !== undefined) ||
        (raw.platform !== 'darwin' && raw.darwin !== undefined)
      ) return { state: 'invalid' }
      return { state: 'valid', identity: file, receipt: raw as LauncherReceipt }
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? { state: 'missing' }
        : { state: 'invalid' }
    }
  }

  private writeReceipt(
    targetPath: string,
    installedContent: string,
    windows?: WindowsLauncherReceiptMetadata,
    darwin?: DarwinLauncherReceiptMetadata,
  ) {
    const receiptDirectory = dirname(this.options.receiptPath)
    mkdirSync(receiptDirectory, { recursive: true, mode: 0o700 })
    const receiptDirectoryDetails = lstatSync(receiptDirectory)
    if (
      receiptDirectoryDetails.isSymbolicLink() ||
      !receiptDirectoryDetails.isDirectory() ||
      (this.platform !== 'win32' && (
        receiptDirectoryDetails.uid !== this.uid ||
        (receiptDirectoryDetails.mode & 0o077) !== 0
      ))
    ) {
      throw new ExternalControlLauncherServiceError(
        'launcher_install_failed',
        'The PiPilot MCP launcher receipt directory is unsafe.',
      )
    }
    const receipt: LauncherReceipt = {
      version: 2,
      platform: this.platform,
      launcherPath: targetPath,
      fingerprint: fingerprint(installedContent),
      ...(darwin ? { darwin } : {}),
      ...(windows ? { windows } : {}),
    }
    writeAtomic(
      this.options.receiptPath,
      `${JSON.stringify(receipt)}\n`,
      0o600,
      false,
    )
  }

  private removeReceipt(expectedIdentity: FileIdentity) {
    const current = readNoFollow(this.options.receiptPath, MAX_RECEIPT_BYTES, {
      uid: this.uid,
      privateFile: this.platform !== 'win32',
    })
    if (!sameIdentity(expectedIdentity, current)) {
      throw new ExternalControlLauncherServiceError(
        'launcher_conflict',
        'The PiPilot MCP launcher receipt changed before removal.',
      )
    }
    unlinkSync(this.options.receiptPath)
  }
}
