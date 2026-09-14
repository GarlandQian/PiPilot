import { randomUUID } from 'node:crypto'
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync,
  rmdirSync, unlinkSync, writeSync,
} from 'node:fs'
import { win32 } from 'node:path'
import { runLauncherCommand } from './launcher-command'
import { ExternalControlLauncherServiceError } from './launcher-error'

export const MAX_DARWIN_ENVIRONMENT_BYTES = 64 * 1024
const MAX_REGISTRY_OUTPUT_BYTES = 64 * 1024
const MAX_REGISTRY_FILE_BYTES = 4 * 1024 * 1024
const LAUNCHCTL_EXECUTABLE = '/bin/launchctl'

export interface DarwinUserPathAdapter {
  read(): string | null | Promise<string | null>
  write(value: string): void | Promise<void>
  remove(): void | Promise<void>
}

export interface WindowsUserPathValue {
  type: 'REG_SZ' | 'REG_EXPAND_SZ'
  value: string
}

export interface WindowsUserPathAdapter {
  read(): WindowsUserPathValue | null | Promise<WindowsUserPathValue | null>
  write(value: WindowsUserPathValue): void | Promise<void>
  remove(): void | Promise<void>
}

export function assertValidDarwinPathValue(value: string) {
  if (
    !value ||
    /[\0\r\n]/u.test(value) ||
    Buffer.byteLength(value, 'utf8') > MAX_DARWIN_ENVIRONMENT_BYTES
  ) {
    throw new ExternalControlLauncherServiceError(
      'launcher_unsafe_target',
      'The current-user PATH is invalid.',
    )
  }
}

export function createDarwinUserPathAdapter(): DarwinUserPathAdapter {
  try {
    const details = lstatSync(LAUNCHCTL_EXECUTABLE)
    if (
      details.isSymbolicLink() ||
      !details.isFile() ||
      details.uid !== 0 ||
      (details.mode & 0o022) !== 0
    ) throw new Error('Invalid launchctl executable.')
  } catch {
    throw new ExternalControlLauncherServiceError(
      'launcher_unavailable',
      'The trusted macOS launchctl executable is unavailable.',
    )
  }
  const run = (args: readonly string[]) => runLauncherCommand(LAUNCHCTL_EXECUTABLE, args, {
    maxBuffer: MAX_DARWIN_ENVIRONMENT_BYTES,
  })
  return {
    async read() {
      const stdout = await run(['getenv', 'PATH'])
      if (stdout.length === 0) return null
      let value = stdout.toString('utf8')
      if (value.endsWith('\n')) value = value.slice(0, -1)
      if (value.endsWith('\r')) value = value.slice(0, -1)
      assertValidDarwinPathValue(value)
      return value
    },
    async write(value) {
      assertValidDarwinPathValue(value)
      await run(['setenv', 'PATH', value])
    },
    async remove() {
      await run(['unsetenv', 'PATH'])
    },
  }
}

function runRegistry(executable: string, args: string[]) {
  return runLauncherCommand(executable, args, {
    maxBuffer: MAX_REGISTRY_OUTPUT_BYTES,
  })
}

function readRegistryBytes(path: string) {
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
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

async function withRegistryOperationDirectory<T>(
  parentDirectory: string,
  operation: (directory: string) => Promise<T>,
) {
  mkdirSync(parentDirectory, { recursive: true, mode: 0o700 })
  const parent = lstatSync(parentDirectory)
  if (parent.isSymbolicLink() || !parent.isDirectory()) {
    throw new Error('The private registry operation directory is invalid.')
  }
  const directory = win32.join(parentDirectory, `registry-${randomUUID()}`)
  mkdirSync(directory, { mode: 0o700 })
  try {
    return await operation(directory)
  } finally {
    try { rmdirSync(directory) } catch { /* operation retains its original error */ }
  }
}

function writeRegistryImportFile(path: string, contents: Buffer) {
  const descriptor = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
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
  const read = async (): Promise<WindowsUserPathValue | null> => {
    return withRegistryOperationDirectory(operationDirectory, async (directory) => {
      const path = win32.join(directory, 'environment.reg')
      try {
        await runRegistry(registryExecutable, ['export', registryKey, path, '/y'])
        return parseWindowsUserPathRegistryExport(readRegistryBytes(path))
      } finally {
        try { unlinkSync(path) } catch { /* best-effort private cleanup */ }
      }
    })
  }
  return {
    read,
    async write(value) {
      await withRegistryOperationDirectory(operationDirectory, async (directory) => {
        const path = win32.join(directory, 'environment.reg')
        writeRegistryImportFile(path, renderWindowsUserPathRegistryImport(value))
        try {
          await runRegistry(registryExecutable, ['import', path])
        } finally {
          try { unlinkSync(path) } catch { /* best-effort private cleanup */ }
        }
      })
    },
    async remove() {
      await runRegistry(
        registryExecutable,
        ['delete', registryKey, '/v', 'Path', '/f'],
      )
    },
  }
}
