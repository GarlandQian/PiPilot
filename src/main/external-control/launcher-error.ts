import type { ExternalControlLauncherError } from '../../shared/external-control'

export class ExternalControlLauncherServiceError extends Error {
  constructor(
    readonly code: ExternalControlLauncherError['code'],
    message: string,
  ) {
    super(message.slice(0, 512))
    this.name = 'ExternalControlLauncherServiceError'
  }
}
