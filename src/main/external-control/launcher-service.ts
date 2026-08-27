import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
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
  rmdirSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { delimiter, dirname, isAbsolute, resolve, win32 } from 'node:path'
import {
  externalControlLauncherSnapshotSchema,
  type ExternalControlLauncherError,
  type ExternalControlLauncherSnapshot,
} from '../../shared/external-control'

const LAUNCHER_NAME = 'pipilot-mcp'
const WINDOWS_LAUNCHER_NAME = 'pipilot-mcp.exe'
const WRAPPER_HEADER = '#!/bin/sh\n# PiPilot MCP launcher v1\n'
const MAX_WRAPPER_BYTES = 64 * 1024
const MAX_RECEIPT_BYTES = 16 * 1024
const MAX_REGISTRY_OUTPUT_BYTES = 64 * 1024
const MAX_REGISTRY_FILE_BYTES = 4 * 1024 * 1024
const MAX_WINDOWS_ENVIRONMENT_CHARS = 32_767

export interface WindowsUserPathValue {
  type: 'REG_SZ' | 'REG_EXPAND_SZ'
  value: string
}

export interface WindowsUserPathAdapter {
  read(): WindowsUserPathValue | null
  write(value: WindowsUserPathValue): void
  remove(): void
}

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
}

export class ExternalControlLauncherServiceError extends Error {
  constructor(
    readonly code: ExternalControlLauncherError['code'],
    message: string,
  ) {
    super(message.slice(0, 512))
    this.name = 'ExternalControlLauncherServiceError'
  }
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

export function persistWindowsLauncherDirectory(
  adapter: WindowsUserPathAdapter,
  directory: string,
  afterPersist: (
    value: WindowsUserPathValue,
    metadata: WindowsLauncherReceiptMetadata,
  ) => void = () => undefined,
) {
  const original = adapter.read()
  const merged = mergeWindowsUserPath(original?.value ?? '', directory)
  if (!merged.changed) return false
  const updated = {
    type: original?.type ?? 'REG_EXPAND_SZ',
    value: merged.value,
  } satisfies WindowsUserPathValue
  try {
    adapter.write(updated)
    const readBack = adapter.read()
    if (readBack?.type !== updated.type || readBack.value !== updated.value) {
      throw new Error('The current-user PATH update did not persist exactly.')
    }
    afterPersist(updated, {
      insertedSeparator: Boolean(original?.value) && !original!.value.endsWith(';'),
      pathValueCreated: original === null,
    })
  } catch (error) {
    try {
      if (original) adapter.write(original)
      else adapter.remove()
    } catch { /* rollback best effort */ }
    throw error
  }
  return true
}

export function persistWindowsLauncherDirectoryRemoval(
  adapter: WindowsUserPathAdapter,
  directory: string,
  metadata: WindowsLauncherReceiptMetadata,
  afterPersist: () => void = () => undefined,
) {
  const original = adapter.read()
  const removed = removeWindowsLauncherDirectory(original?.value ?? '', directory, metadata)
  if (!removed.changed) {
    afterPersist()
    return false
  }
  const shouldRemoveValue = metadata.pathValueCreated && removed.value === ''
  const updated = original
    ? { type: original.type, value: removed.value } satisfies WindowsUserPathValue
    : null
  try {
    if (shouldRemoveValue) adapter.remove()
    else if (updated) adapter.write(updated)
    else throw new Error('The current-user PATH value disappeared before removal.')
    const readBack = adapter.read()
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
    afterPersist()
  } catch (error) {
    try {
      if (original) adapter.write(original)
      else adapter.remove()
      const restored = adapter.read()
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

function runRegistry(executable: string, args: string[]) {
  return spawnSync(executable, args, {
    maxBuffer: MAX_REGISTRY_OUTPUT_BYTES,
    shell: false,
    windowsHide: true,
  })
}

function readRegistryBytes(path: string) {
  const descriptor = openSync(path, constants.O_RDONLY | noFollowFlag())
  try {
    const details = fstatSync(descriptor)
    if (!details.isFile() || details.size > MAX_REGISTRY_FILE_BYTES) {
      throw new Error('The exported registry file is invalid.')
    }
    const bytes = Buffer.alloc(details.size)
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (count === 0) break
      offset += count
    }
    if (offset !== bytes.length) {
      throw new Error('The exported registry file changed while being read.')
    }
    return bytes
  } finally {
    closeSync(descriptor)
  }
}

function decodeRegistryString(value: string) {
  if (value.length < 2 || value[0] !== '"' || value[value.length - 1] !== '"') {
    throw new Error('The exported registry string is invalid.')
  }
  let decoded = ''
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index]!
    if (character === '"') {
      throw new Error('The exported registry string contains an unescaped quote.')
    }
    if (character !== '\\') {
      decoded += character
      continue
    }
    const escaped = value[index + 1]
    if (escaped !== '\\' && escaped !== '"') {
      throw new Error('The exported registry string contains an invalid escape.')
    }
    decoded += escaped
    index += 1
  }
  if (decoded.includes('\0')) {
    throw new Error('The exported registry string contains a NUL byte.')
  }
  return decoded
}

function decodeRegistryHex(value: string, expectedType: '1' | '2') {
  const match = value.match(new RegExp(`^hex\\(${expectedType}\\):(.*)$`, 'iu'))
  if (!match) return null
  const tokens = match[1]!.split(',').map((token) => token.trim())
  if (
    tokens.length < 2 ||
    tokens.some((token) => !/^[a-f0-9]{2}$/iu.test(token))
  ) {
    throw new Error('The exported registry hex value is invalid.')
  }
  const bytes = Buffer.from(tokens.map((token) => Number.parseInt(token, 16)))
  if (
    bytes.length % 2 !== 0 ||
    bytes[bytes.length - 2] !== 0 ||
    bytes[bytes.length - 1] !== 0
  ) {
    throw new Error('The exported registry string is not NUL terminated.')
  }
  const decoded = bytes.subarray(0, -2).toString('utf16le')
  if (decoded.includes('\0')) {
    throw new Error('The exported registry string contains an embedded NUL byte.')
  }
  return decoded
}

export function parseWindowsUserPathRegistryExport(bytes: Buffer) {
  if (
    bytes.length < 2 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xfe ||
    (bytes.length - 2) % 2 !== 0
  ) {
    throw new Error('The exported registry file is not UTF-16LE.')
  }
  const contents = bytes.subarray(2).toString('utf16le')
  const lines = contents.replace(/\r\n?/gu, '\n').split('\n')
  if (lines[0] !== 'Windows Registry Editor Version 5.00') {
    throw new Error('The exported registry file header is invalid.')
  }
  const sectionIndex = lines.findIndex((line) =>
    line.toLocaleLowerCase('en-US') === '[hkey_current_user\\environment]')
  if (sectionIndex < 0) {
    throw new Error('The current-user environment registry key is missing.')
  }

  let parsed: WindowsUserPathValue | null | undefined
  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!
    if (line.startsWith('[')) break
    const match = line.match(/^"Path"=(.*)$/iu)
    if (!match) continue
    if (parsed !== undefined) {
      throw new Error('The exported registry file contains duplicate PATH values.')
    }
    let encoded = match[1]!
    if (/^hex\([12]\):/iu.test(encoded)) {
      while (/\\\s*$/u.test(encoded)) {
        encoded = encoded.replace(/\\\s*$/u, '')
        index += 1
        if (index >= lines.length) {
          throw new Error('The exported registry hex value is incomplete.')
        }
        encoded += lines[index]!.trimStart()
      }
    }
    if (encoded.startsWith('"') && encoded.endsWith('"')) {
      parsed = { type: 'REG_SZ', value: decodeRegistryString(encoded) }
      continue
    }
    const regular = decodeRegistryHex(encoded, '1')
    if (regular !== null) {
      parsed = { type: 'REG_SZ', value: regular }
      continue
    }
    const expanded = decodeRegistryHex(encoded, '2')
    if (expanded !== null) {
      parsed = { type: 'REG_EXPAND_SZ', value: expanded }
      continue
    }
    throw new Error('The exported PATH registry type is unsupported.')
  }
  return parsed ?? null
}

export function renderWindowsUserPathRegistryImport(value: WindowsUserPathValue) {
  if (value.value.includes('\0')) {
    throw new Error('The current-user PATH contains a NUL byte.')
  }
  const bytes = Buffer.concat([
    Buffer.from(value.value, 'utf16le'),
    Buffer.from([0, 0]),
  ])
  const tokens = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'))
  const chunks: string[] = []
  for (let index = 0; index < tokens.length; index += 24) {
    chunks.push(tokens.slice(index, index + 24).join(','))
  }
  const hex = chunks.map((chunk, index) =>
    `${index === 0 ? '' : '  '}${chunk}${index < chunks.length - 1 ? ',\\' : ''}`,
  ).join('\r\n')
  const registryText = [
    'Windows Registry Editor Version 5.00',
    '',
    '[HKEY_CURRENT_USER\\Environment]',
    `"Path"=hex(${value.type === 'REG_SZ' ? '1' : '2'}):${hex}`,
    '',
  ].join('\r\n')
  return Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(registryText, 'utf16le'),
  ])
}

function withRegistryOperationDirectory<T>(
  parentDirectory: string,
  operation: (directory: string) => T,
) {
  mkdirSync(parentDirectory, { recursive: true, mode: 0o700 })
  const parent = lstatSync(parentDirectory)
  if (parent.isSymbolicLink() || !parent.isDirectory()) {
    throw new Error('The private registry operation directory is invalid.')
  }
  const directory = win32.join(parentDirectory, `registry-${randomUUID()}`)
  mkdirSync(directory, { mode: 0o700 })
  try {
    return operation(directory)
  } finally {
    try { rmdirSync(directory) } catch { /* operation retains its original error */ }
  }
}

function writeRegistryImportFile(path: string, contents: Buffer) {
  const descriptor = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
    0o600,
  )
  try {
    let offset = 0
    while (offset < contents.length) {
      offset += writeSync(descriptor, contents, offset, contents.length - offset, offset)
    }
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

export function createWindowsUserPathAdapter(
  environment: NodeJS.ProcessEnv = process.env,
  operationDirectory = '',
): WindowsUserPathAdapter {
  const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT
  if (!systemRoot || !win32.isAbsolute(systemRoot) || systemRoot.includes('\0')) {
    throw new ExternalControlLauncherServiceError(
      'launcher_unavailable',
      'The trusted Windows registry tool is unavailable.',
    )
  }
  const registryExecutable = win32.join(systemRoot, 'System32', 'reg.exe')
  try {
    const registryDetails = lstatSync(registryExecutable)
    if (registryDetails.isSymbolicLink() || !registryDetails.isFile()) {
      throw new Error('Invalid registry executable.')
    }
  } catch {
    throw new ExternalControlLauncherServiceError(
      'launcher_unavailable',
      'The trusted Windows registry tool is unavailable.',
    )
  }
  const registryKey = 'HKCU\\Environment'
  if (!operationDirectory || !win32.isAbsolute(operationDirectory)) {
    throw new ExternalControlLauncherServiceError(
      'launcher_unavailable',
      'The private Windows registry operation directory is unavailable.',
    )
  }
  const read = (): WindowsUserPathValue | null => {
    return withRegistryOperationDirectory(operationDirectory, (directory) => {
      const path = win32.join(directory, 'environment.reg')
      const result = runRegistry(registryExecutable, [
        'export', registryKey, path, '/y',
      ])
      if (result.error) throw result.error
      if (result.status !== 0) {
        throw new Error('The current-user environment is unavailable.')
      }
      try {
        return parseWindowsUserPathRegistryExport(readRegistryBytes(path))
      } finally {
        try { unlinkSync(path) } catch { /* best-effort private cleanup */ }
      }
    })
  }
  return {
    read,
    write(value) {
      withRegistryOperationDirectory(operationDirectory, (directory) => {
        const path = win32.join(directory, 'environment.reg')
        writeRegistryImportFile(path, renderWindowsUserPathRegistryImport(value))
        try {
          const result = runRegistry(registryExecutable, ['import', path])
          if (result.error) throw result.error
          if (result.status !== 0) {
            throw new Error('The current-user PATH could not be updated.')
          }
        } finally {
          try { unlinkSync(path) } catch { /* best-effort private cleanup */ }
        }
      })
    },
    remove() {
      const result = runRegistry(
        registryExecutable,
        ['delete', registryKey, '/v', 'Path', '/f'],
      )
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error('The current-user PATH could not be restored.')
    },
  }
}

export class ExternalControlLauncherService {
  private readonly platform: NodeJS.Platform
  private readonly environment: NodeJS.ProcessEnv
  private readonly uid: number | undefined
  private readonly windowsUserPath: WindowsUserPathAdapter | null

  constructor(private readonly options: ExternalControlLauncherServiceOptions) {
    this.platform = options.platform ?? process.platform
    this.environment = options.environment ?? process.env
    this.uid = options.uid ?? process.getuid?.()
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
    return structuredClone(this.inspectInternal().snapshot)
  }

  install() {
    const inspection = this.inspectInternal()
    if (inspection.snapshot.state === 'installed') return inspection.snapshot
    if (inspection.snapshot.state === 'unsupported' || !inspection.targetPath) {
      const error = inspection.snapshot.error
      throw new ExternalControlLauncherServiceError(
        error?.code ?? 'launcher_unavailable',
        error?.message ?? 'The PiPilot MCP launcher cannot be installed safely.',
      )
    }
    try {
      return this.platform === 'win32'
        ? this.installWindows(inspection)
        : this.installPosix(inspection)
    } catch (error) {
      if (error instanceof ExternalControlLauncherServiceError) throw error
      throw new ExternalControlLauncherServiceError(
        'launcher_install_failed',
        'The PiPilot MCP launcher could not be installed.',
      )
    }
  }

  uninstall() {
    const receipt = this.readReceipt()
    if (receipt.state === 'invalid') {
      throw new ExternalControlLauncherServiceError(
        'launcher_conflict',
        'The existing PiPilot MCP launcher receipt is invalid.',
      )
    }
    if (receipt.state === 'missing') {
      const inspection = this.inspectInternal()
      if (inspection.snapshot.state === 'missing') return inspection.snapshot
      throw new ExternalControlLauncherServiceError(
        'launcher_conflict',
        'The pipilot-mcp command is not managed by PiPilot.',
      )
    }
    try {
      return this.platform === 'win32'
        ? this.uninstallWindows(receipt)
        : this.uninstallPosix(receipt)
    } catch (error) {
      if (error instanceof ExternalControlLauncherServiceError) throw error
      throw new ExternalControlLauncherServiceError(
        'launcher_uninstall_failed',
        'The PiPilot MCP launcher could not be uninstalled.',
      )
    }
  }

  private inspectInternal(): Inspection {
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
    return this.inspectPosix()
  }

  private inspectWindows(): Inspection {
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
      const windowsPath = this.windowsUserPath.read()
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

    for (const rawDirectory of pathValue.split(delimiter)) {
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
        if (
          details.isSymbolicLink() ||
          !details.isDirectory() ||
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

  private installPosix(inspection: Inspection) {
    const fresh = this.inspectPosix()
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
    try {
      this.writeReceipt(fresh.targetPath, fresh.wrapper)
    } catch (error) {
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
    const verified = this.inspectPosix().snapshot
    if (verified.state !== 'installed') {
      throw new ExternalControlLauncherServiceError(
        'launcher_install_failed',
        'The installed PiPilot MCP launcher could not be verified.',
      )
    }
    return verified
  }

  private installWindows(inspection: Inspection) {
    const adapter = this.windowsUserPath!
    const changed = persistWindowsLauncherDirectory(
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

  private uninstallWindows(receipt: Extract<ReceiptRead, { state: 'valid' }>) {
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
    const changed = persistWindowsLauncherDirectoryRemoval(
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
        (raw.platform !== 'win32' && raw.windows !== undefined)
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
