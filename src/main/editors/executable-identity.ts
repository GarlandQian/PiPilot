import { readlink, realpath } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

interface ExecutableIdentityOptions {
  platform?: NodeJS.Platform
  realpath?: (path: string) => Promise<string>
  readlink?: (path: string) => Promise<string>
}

const MAX_LINKS = 32
const MAX_CACHED_IDENTITIES = 4_096

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

function permissionDenied(error: unknown) {
  const code = errorCode(error)
  return code === 'EACCES' || code === 'EPERM'
}

/** Executable identity is separate from its launch path: Store apps may require their alias to launch. */
export class ExecutableIdentityResolver {
  private readonly platform: NodeJS.Platform
  private readonly resolveRealpath: (path: string) => Promise<string>
  private readonly resolveReadlink: (path: string) => Promise<string>
  private readonly cache = new Map<string, Promise<string>>()

  constructor(options: ExecutableIdentityOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.resolveRealpath = options.realpath ?? realpath
    this.resolveReadlink = options.readlink ?? readlink
  }

  /** Clear at discovery refresh so an updated app's alias can acquire its new target. */
  clear(): void { this.cache.clear() }

  async identity(executable: string): Promise<string> {
    const original = this.key(executable)
    const cached = this.cache.get(original)
    if (cached) return cached
    // Bound retained work even if a caller keeps a resolver across many scans.
    if (this.cache.size >= MAX_CACHED_IDENTITIES) this.cache.delete(this.cache.keys().next().value!)
    const pending = this.resolve(executable, original)
    this.cache.set(original, pending)
    return pending
  }

  private get path() { return this.platform === 'win32' ? win32 : posix }

  private ordinaryPath(value: string) {
    if (this.platform !== 'win32') return value
    const path = value.replace(/\//g, '\\')
    if (/^\\\\\?\\UNC\\/i.test(path)) return `\\\\${path.slice(8)}`
    if (/^\\\\\?\\[a-z]:\\/i.test(path)) return path.slice(4)
    return path
  }

  private valid(value: string) {
    if (!value || /[\0\r\n]/.test(value)) return false
    if (this.platform !== 'win32') return posix.isAbsolute(value)
    // Do not interpret device paths or drive-relative paths as installed files.
    const path = this.ordinaryPath(value)
    const drive = /^[a-z]:\\/i.test(path)
    if (/[\x00-\x1f<>"|?*:]/.test(drive ? path.slice(2) : path)) return false
    const unc = /^\\\\([^\\]+)\\[^\\]+(?:\\|$)/.exec(path)
    return drive || Boolean(unc && unc[1] !== '.')
  }

  private key(value: string) {
    if (!this.valid(value)) return value
    const normalized = this.path.normalize(this.ordinaryPath(value))
    return this.platform === 'win32' ? normalized.toLowerCase() : normalized
  }

  private async resolve(executable: string, original: string): Promise<string> {
    if (!this.valid(executable)) return original
    let current = this.ordinaryPath(executable)
    const visited = new Set<string>()
    for (let depth = 0; depth < MAX_LINKS; depth += 1) {
      const identity = this.key(current)
      if (visited.has(identity)) return original
      visited.add(identity)
      let realpathError: unknown
      try {
        const resolved = await this.resolveRealpath(current)
        return this.valid(resolved) ? this.key(resolved) : original
      } catch (error) { realpathError = error }

      try {
        // libuv fs__readlink_handle reads IO_REPARSE_TAG_APPEXECLINK's target
        // without opening the protected WindowsApps executable itself.
        // https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c
        const target = await this.resolveReadlink(current)
        if (!target || /[\0\r\n]/.test(target)) return original
        const ordinary = this.ordinaryPath(target)
        // Reject unsupported Windows device and drive-relative targets instead
        // of allowing path.resolve to reinterpret them using process state.
        if (this.platform === 'win32' && (/^\\\\[?.]\\/.test(ordinary) || /^[a-z]:(?!\\)/i.test(ordinary))) return original
        const next = this.path.resolve(this.path.dirname(current), ordinary)
        if (!this.valid(next)) return original
        current = next
      } catch (error) {
        // An explicit link target remains authoritative when the Store denies
        // access. Missing/broken links, cycles and other errors stay distinct.
        if (depth > 0 && permissionDenied(realpathError) && (permissionDenied(error) || errorCode(error) === 'EINVAL')) return identity
        return original
      }
    }
    return original
  }
}
