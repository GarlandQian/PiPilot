import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import {
  ExternalControlError,
  externalControlDescriptorSchema,
  type ExternalControlDescriptor,
} from '../../shared/external-control'

function assertPrivateFile(filePath: string) {
  const details = statSync(filePath)
  const hasRelaxedUnixPermissions = process.platform !== 'win32' &&
    (details.mode & 0o077) !== 0
  if (!details.isFile() || hasRelaxedUnixPermissions) {
    throw new ExternalControlError(
      'authentication_failed',
      'The PiPilot external-control descriptor is not private.',
    )
  }
  if (typeof process.getuid === 'function' && details.uid !== process.getuid()) {
    throw new ExternalControlError(
      'authentication_failed',
      'The PiPilot external-control descriptor has another owner.',
    )
  }
}

export class ExternalControlDescriptorRepository {
  constructor(private readonly filePath: string) {}

  get path() {
    return this.filePath
  }

  read(): ExternalControlDescriptor {
    try {
      assertPrivateFile(this.filePath)
      return externalControlDescriptorSchema.parse(
        JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown,
      )
    } catch (error) {
      if (error instanceof ExternalControlError) throw error
      throw new ExternalControlError(
        'pipilot_unavailable',
        'PiPilot External Control is unavailable.',
      )
    }
  }

  write(rawDescriptor: ExternalControlDescriptor) {
    const descriptor = externalControlDescriptorSchema.parse(rawDescriptor)
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 })
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(descriptor)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      renameSync(temporaryPath, this.filePath)
      chmodSync(this.filePath, 0o600)
    } catch (error) {
      try { unlinkSync(temporaryPath) } catch { /* no temporary file */ }
      throw error
    }
  }

  remove(expectedInstanceId?: string) {
    if (expectedInstanceId !== undefined) {
      try {
        const current = this.read()
        if (current.instanceId !== expectedInstanceId) return false
      } catch {
        // A malformed or missing descriptor is safe to remove.
      }
    }
    try {
      unlinkSync(this.filePath)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
}
