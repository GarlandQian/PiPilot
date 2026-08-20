import { lstat, unlink as unlinkFile } from 'node:fs/promises'
import {
  conversationScopeSchema,
  sessionCatalogDeleteResultSchema,
  type ConversationScope,
  type SessionCatalogDeleteResult,
  type SessionCatalogSelectionToken,
} from '../../shared/conversation-scope'
import type { PiRuntimeFrontend } from '../pi-host/pi-runtime-frontend'
import type { OfficialPiSessionActivationService } from './official-pi-session-activation-service'
import type {
  OfficialPiSessionCatalog,
  ResolvedOfficialPiSessionDeletionTarget,
} from './official-pi-session-catalog'

type SessionDeletionActivationService = Pick<
  OfficialPiSessionActivationService,
  'stop'
>

type SessionDeletionCatalog = Pick<
  OfficialPiSessionCatalog,
  'consumeForDeletion' | 'invalidate' | 'revalidateDeletionTarget'
>

type SessionDeletionRuntimeHost = Pick<
  PiRuntimeFrontend,
  'isActiveSession' | 'releaseSession'
>

export type OfficialPiSessionDeletionErrorCode = 'SESSION_DELETE_FAILED'

export class OfficialPiSessionDeletionError extends Error {
  constructor(
    readonly code: OfficialPiSessionDeletionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'OfficialPiSessionDeletionError'
  }
}

interface OfficialPiSessionDeletionServiceOptions {
  activationService: SessionDeletionActivationService
  catalog: SessionDeletionCatalog
  runtimeHost: SessionDeletionRuntimeHost
  trashItem(path: string): Promise<void>
  unlink?(path: string): Promise<void>
}

function isMissingFile(error: unknown) {
  return error instanceof Error && (
    (error as NodeJS.ErrnoException).code === 'ENOENT' ||
    (error as NodeJS.ErrnoException).code === 'ENOTDIR'
  )
}

async function pathExists(path: string) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    return !isMissingFile(error)
  }
}

export class OfficialPiSessionDeletionService {
  private readonly activationService: SessionDeletionActivationService
  private readonly catalog: SessionDeletionCatalog
  private readonly runtimeHost: SessionDeletionRuntimeHost
  private readonly trashItem: (path: string) => Promise<void>
  private readonly unlink: (path: string) => Promise<void>

  constructor(options: OfficialPiSessionDeletionServiceOptions) {
    this.activationService = options.activationService
    this.catalog = options.catalog
    this.runtimeHost = options.runtimeHost
    this.trashItem = options.trashItem
    this.unlink = options.unlink ?? unlinkFile
  }

  async delete(
    rawScope: ConversationScope,
    selectionToken: SessionCatalogSelectionToken,
  ): Promise<SessionCatalogDeleteResult> {
    const scope = conversationScopeSchema.parse(rawScope)
    const target = await this.catalog.consumeForDeletion(scope, selectionToken)
    try {
      const activeDeleted = await this.matchesActiveRuntime(target)

      if (activeDeleted) {
        try {
          await this.activationService.stop()
        } catch {
          throw this.failed()
        }
      }

      try {
        await this.runtimeHost.releaseSession(target.sessionFile)
      } catch {
        throw this.failed()
      }

      await this.catalog.revalidateDeletionTarget(target)
      const disposition = await this.remove(target)
      return sessionCatalogDeleteResultSchema.parse({
        scope: target.scope,
        sessionId: target.sessionId,
        activeDeleted,
        disposition,
      })
    } finally {
      this.catalog.invalidate(target.scope)
    }
  }

  private async matchesActiveRuntime(
    target: ResolvedOfficialPiSessionDeletionTarget,
  ) {
    return this.runtimeHost.isActiveSession(target.scope, target.sessionFile)
  }

  private async remove(target: ResolvedOfficialPiSessionDeletionTarget) {
    try {
      await this.trashItem(target.sessionFile)
      if (!(await pathExists(target.sessionFile))) return 'trash' as const
    } catch {
      // Electron trash can be unavailable on a supported desktop. The fallback
      // is the same explicit permanent deletion behavior used by official Pi.
    }

    await this.catalog.revalidateDeletionTarget(target)
    try {
      await this.unlink(target.sessionFile)
    } catch {
      if (await pathExists(target.sessionFile)) throw this.failed()
    }
    if (await pathExists(target.sessionFile)) throw this.failed()
    return 'unlink' as const
  }

  private failed() {
    return new OfficialPiSessionDeletionError(
      'SESSION_DELETE_FAILED',
      'The selected session could not be deleted.',
    )
  }
}
