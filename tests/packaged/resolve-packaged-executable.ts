import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { join, resolve } from 'node:path'

interface PackagedTargetOptions {
  platform?: NodeJS.Platform
  architecture?: string
  explicitPath?: string
  root?: string
  exists?: (path: string) => boolean
}

export function resolvePackagedExecutable(options: PackagedTargetOptions = {}) {
  const platform = options.platform ?? process.platform
  const architecture = options.architecture ?? process.env.PIPILOT_PACKAGED_ARCH ?? process.arch
  const explicitPath = options.explicitPath ?? process.env.PIPILOT_PACKAGED_APP_PATH
  const root = options.root ?? process.cwd()
  const exists = options.exists ?? existsSync
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error(`Unsupported packaged test architecture: ${architecture}`)
  }
  if (platform !== 'darwin' && architecture !== 'x64') {
    throw new Error(`No ${platform}/${architecture} release target is configured.`)
  }
  const candidates = explicitPath
    ? [platform === 'darwin' && explicitPath.endsWith('.app')
        ? join(explicitPath, 'Contents', 'MacOS', 'PiPilot')
        : explicitPath]
    : platform === 'darwin'
      ? architecture === 'arm64'
        ? ['release/mac-arm64/PiPilot.app/Contents/MacOS/PiPilot']
        : ['release/mac/PiPilot.app/Contents/MacOS/PiPilot', 'release/mac-x64/PiPilot.app/Contents/MacOS/PiPilot']
      : platform === 'win32'
        ? ['release/win-unpacked/PiPilot.exe']
        : ['release/linux-unpacked/pipilot']
  const executable = candidates.map((candidate) => resolve(root, candidate)).find(exists)
  if (!executable) {
    throw new Error(`No packaged PiPilot ${platform}/${architecture} executable was found. Build that target before its smoke test.`)
  }
  return executable
}

export function macBinaryArchitectures(header: Buffer): string[] {
  if (header.length < 8) return []
  const name = (cpu: number) => cpu === 0x0100000c ? 'arm64' : cpu === 0x01000007 ? 'x64' : ''
  if (header.readUInt32LE(0) === 0xfeedfacf) return [name(header.readUInt32LE(4))].filter(Boolean)
  const magic = header.readUInt32BE(0)
  if (magic !== 0xcafebabe && magic !== 0xcafebabf) return []
  const stride = magic === 0xcafebabf ? 32 : 20
  const count = header.readUInt32BE(4)
  if (count > 16 || 8 + count * stride > header.length) return []
  return Array.from({ length: count }, (_, index) => name(header.readUInt32BE(8 + index * stride))).filter(Boolean)
}

/** Check the binary itself, so a stale/cross-architecture override cannot pass. */
export function verifyPackagedArchitecture(executable: string) {
  if (process.platform !== 'darwin') return
  const expected = process.env.PIPILOT_PACKAGED_ARCH ?? process.arch
  const handle = openSync(executable, 'r')
  try {
    const header = Buffer.alloc(1_024)
    const length = readSync(handle, header, 0, header.length, 0)
    if (!macBinaryArchitectures(header.subarray(0, length)).includes(expected)) {
      throw new Error(`The packaged executable does not contain requested architecture ${expected}: ${executable}`)
    }
  } finally {
    closeSync(handle)
  }
}
