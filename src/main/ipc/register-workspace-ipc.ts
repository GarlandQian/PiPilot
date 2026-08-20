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
  workspaceSetPinnedContract,
} from '../../shared/ipc/contracts'
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
}

function mapWorkspaceError(error: unknown): never {
  if (error instanceof WorkspaceRepositoryError) {
    throw new MainProcessError(error.code, error.message)
  }
  if (error instanceof WorkspaceContentError) {
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
