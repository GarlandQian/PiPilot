import { randomUUID } from 'node:crypto'
import { dialog, type BrowserWindow } from 'electron'
import {
  ipcChannels,
  workspaceChangedEventSchema,
  workspaceChooseContract,
  workspaceDiffListContract,
  workspaceDiffReadContract,
  workspaceFilePreviewContract,
  workspaceFilesListContract,
  workspaceFilesSearchContract,
  workspaceGetContract,
  workspaceOpenContract,
  workspaceRemoveContract,
  workspaceSetPinnedContract,
} from '../../shared/ipc/contracts'
import type { ConversationContextService } from '../conversations/conversation-context-service'
import { ConversationScopeError } from '../conversations/conversation-scope-resolver'
import { OfficialPiSessionActivationError } from '../conversations/official-pi-session-activation-service'
import { PiRuntimeFrontendError } from '../pi-host/pi-runtime-frontend'
import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from '../repositories/workspace-repository'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import {
  WorkspaceContentError,
  type WorkspaceContentService,
} from '../workspace/workspace-content-service'
import {
  createTrustedSenderValidator,
  MainProcessError,
  registerValidatedHandler,
} from './validated-handler'

interface RegisterWorkspaceIpcOptions {
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
  repository: WorkspaceRepository
  contentService: WorkspaceContentService
  contextService: Pick<ConversationContextService, 'getSnapshot' | 'newConversation'>
}

function mapWorkspaceError(error: unknown): never {
  if (error instanceof WorkspaceRepositoryError) {
    throw new MainProcessError(error.code, error.message)
  }
  if (error instanceof WorkspaceContentError) {
    throw new MainProcessError(error.code, error.message)
  }
  if (error instanceof PiRuntimeFrontendError) {
    throw new MainProcessError(error.code, error.message)
  }
  if (
    error instanceof OfficialPiSessionActivationError ||
    error instanceof ConversationScopeError
  ) {
    throw new MainProcessError(error.code, error.message)
  }
  throw error
}

function mapWorkspaceContentError(error: unknown): never {
  if (error instanceof WorkspaceContentError) {
    throw new MainProcessError(error.code, error.message)
  }
  throw new MainProcessError(
    'WORKSPACE_CONTENT_FAILED',
    'The workspace content operation could not be completed.',
  )
}

export function registerWorkspaceIpc({
  getMainWindow,
  policy,
  repository,
  contentService,
  contextService,
}: RegisterWorkspaceIpcOptions) {
  const isTrustedSender = createTrustedSenderValidator(policy, getMainWindow)

  registerValidatedHandler(workspaceGetContract, isTrustedSender, () => repository.get())

  registerValidatedHandler(
    workspaceChooseContract,
    isTrustedSender,
    async () => {
      const window = getMainWindow()
      if (!window || window.isDestroyed()) {
        throw new MainProcessError('WINDOW_UNAVAILABLE', 'The main window is unavailable.')
      }

      const selection = await dialog.showOpenDialog(window, {
        properties: ['openDirectory', 'createDirectory'],
      })
      if (selection.canceled || !selection.filePaths[0]) {
        return { cancelled: true as const, snapshot: repository.get() }
      }

      try {
        const location = await repository.activatePath(selection.filePaths[0])
        return {
          cancelled: false as const,
          snapshot: location.snapshot,
        }
      } catch (error) {
        mapWorkspaceError(error)
      }
    },
  )

  registerValidatedHandler(
    workspaceOpenContract,
    isTrustedSender,
    async ({ workspaceId }) => {
      try {
        const location = await repository.activate(workspaceId)
        return { snapshot: location.snapshot }
      } catch (error) {
        mapWorkspaceError(error)
      }
    },
  )

  registerValidatedHandler(
    workspaceRemoveContract,
    isTrustedSender,
    async ({ workspaceId }) => {
      try {
        const exists = repository.get().recent.some((workspace) => workspace.id === workspaceId)
        if (!exists) {
          throw new WorkspaceRepositoryError(
            'WORKSPACE_NOT_FOUND',
            'The workspace was not found.',
          )
        }

        const activeScope = contextService.getSnapshot().activeScope
        if (activeScope.kind === 'project' && activeScope.workspaceId === workspaceId) {
          const activation = await contextService.newConversation({ kind: 'projectless' })
          return {
            activeRemoved: true as const,
            workspaceId,
            snapshot: repository.remove(workspaceId),
            activation,
          }
        }

        return {
          activeRemoved: false as const,
          workspaceId,
          snapshot: repository.remove(workspaceId),
        }
      } catch (error) {
        mapWorkspaceError(error)
      }
    },
  )

  registerValidatedHandler(
    workspaceSetPinnedContract,
    isTrustedSender,
    ({ workspaceId, pinned }) => ({
      workspaceId,
      pinned,
      snapshot: repository.setPinned(workspaceId, pinned),
    }),
  )

  registerValidatedHandler(
    workspaceFilesListContract,
    isTrustedSender,
    ({ workspaceId, path }) =>
      contentService.listDirectory(workspaceId, path).catch(mapWorkspaceContentError),
  )
  registerValidatedHandler(
    workspaceFilePreviewContract,
    isTrustedSender,
    ({ workspaceId, path }) =>
      contentService.previewFile(workspaceId, path).catch(mapWorkspaceContentError),
  )
  registerValidatedHandler(
    workspaceFilesSearchContract,
    isTrustedSender,
    ({ workspaceId, query }) =>
      contentService.searchPaths(workspaceId, query).catch(mapWorkspaceContentError),
  )
  registerValidatedHandler(
    workspaceDiffListContract,
    isTrustedSender,
    ({ workspaceId }) =>
      contentService.listChanges(workspaceId).catch(mapWorkspaceContentError),
  )
  registerValidatedHandler(
    workspaceDiffReadContract,
    isTrustedSender,
    ({ workspaceId, path }) =>
      contentService.readDiff(workspaceId, path).catch(mapWorkspaceContentError),
  )
  repository.subscribe((snapshot) => {
    const window = getMainWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(
      ipcChannels.workspaceChanged,
      workspaceChangedEventSchema.parse({ eventId: randomUUID(), snapshot }),
    )
  })
}
