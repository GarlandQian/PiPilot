import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import {
  ipcChannels,
  workspaceChangedEventSchema,
  workspaceChooseContract,
  workspaceDiffApplyContract,
  workspaceDiffApplyHunkContract,
  workspaceDiffListBranchContract,
  workspaceDiffListContract,
  workspaceDiffReadContract,
  workspaceFilePreviewContract,
  workspaceFileMediaContract,
  workspaceFileRevealContract,
  workspaceFilesExistContract,
  workspaceDiffListCommitsContract,
  workspaceDiffListCommitContract,
  workspaceDiffSidesContract,
  workspaceGitStatusContract,
  workspaceGitCommitContract,
  workspaceGitSuggestMessageContract,
  editorsListContract,
  editorsOpenContract,
  workspaceFilesListContract,
  workspaceFilesSearchContract,
  workspaceGetContract,
  workspaceOpenContract,
  workspaceRemoveContract,
  workspaceRevealContract,
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
import type { TerminalService } from '../terminal/terminal-service'
import { ExternalEditors } from '../editors/external-editors'
import { macAppIcon } from '../editors/app-icons'
import { ProjectWorkflowError } from '../project-actions/workflow-storage'
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
  terminalService: Pick<TerminalService, 'disposeScope'>
  withRemovableProject?<T>(workspaceId: string, operation: () => Promise<T>): Promise<T>
  /** One completion from a configured model (the Pi management helper). */
  completeText?(input: { providerId: string; modelId: string; systemPrompt: string; prompt: string; maxTokens: number }): Promise<string>
}

const COMMIT_MESSAGE_PROMPT = [
  'You write Git commit messages.',
  'Describe the change shown, not the conversation that produced it.',
  'First line: a summary of at most 72 characters, in the imperative mood, with no trailing period.',
  'If the change needs explaining, add a blank line and a short body wrapped at 72 columns.',
  'Follow the style and language of the recent commit subjects when they are given.',
  'Reply with the commit message only: no quotes, no code fences, no commentary.',
].join('\n')

/** Models sometimes wrap the message anyway; keep only the message. */
export function cleanCommitMessage(text: string) {
  return text.trim().replace(/^```[a-z]*\n?/iu, '').replace(/\n?```$/u, '').replace(/^(["'`])([\s\S]*)\1$/u, '$2').trim()
}

function mapWorkspaceError(error: unknown): never {
  if (error instanceof ProjectWorkflowError) {
    throw new MainProcessError(error.code, error.message)
  }
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
  terminalService,
  withRemovableProject,
  completeText,
}: RegisterWorkspaceIpcOptions) {
  const isTrustedSender = createTrustedSenderValidator(policy, getMainWindow)
  const editors = new ExternalEditors({
    openPath: (path) => shell.openPath(path),
    showItemInFolder: (path) => shell.showItemInFolder(path),
    iconFor: async (path) => {
      if (process.platform === 'darwin') return macAppIcon(path)
      const image = await app.getFileIcon(path, { size: 'normal' })
      return image.isEmpty() ? undefined : image.toDataURL()
    },
  })

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

        const remove = async () => {
          const activeScope = contextService.getSnapshot().activeScope
          if (activeScope.kind === 'project' && activeScope.workspaceId === workspaceId) {
            const activation = await contextService.newConversation({ kind: 'projectless' })
            await terminalService.disposeScope({ kind: 'project', workspaceId })
            return {
              activeRemoved: true as const,
              workspaceId,
              snapshot: repository.remove(workspaceId),
              activation,
            }
          }

          await terminalService.disposeScope({ kind: 'project', workspaceId })
          return {
            activeRemoved: false as const,
            workspaceId,
            snapshot: repository.remove(workspaceId),
          }
        }
        // Hold action admission across activation and terminal teardown so a
        // late command cannot become unreachable when this workspace ID leaves.
        return await (withRemovableProject ? withRemovableProject(workspaceId, remove) : remove())
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
    workspaceRevealContract,
    isTrustedSender,
    async ({ workspaceId }) => {
      // The renderer names a project, never a path.
      const location = repository.getLocation(workspaceId)
      const directory = location ? await stat(location.path).then((entry) => entry.isDirectory(), () => false) : false
      if (!location || !directory) {
        if (location) repository.markUnavailable(workspaceId)
        throw new MainProcessError('WORKSPACE_UNAVAILABLE', 'The workspace is unavailable.')
      }
      shell.showItemInFolder(location.path)
      return { workspaceId }
    },
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
    workspaceDiffListBranchContract,
    isTrustedSender,
    ({ workspaceId }) =>
      contentService.listBranchChanges(workspaceId).catch(mapWorkspaceContentError),
  )
  registerValidatedHandler(
    workspaceDiffApplyHunkContract,
    isTrustedSender,
    ({ workspaceId, action, change, hunk }) =>
      contentService.applyHunk(workspaceId, action, change, hunk).catch(mapWorkspaceContentError),
  )
  registerValidatedHandler(
    workspaceDiffApplyContract,
    isTrustedSender,
    ({ workspaceId, action, changes }) =>
      contentService.applyChanges(workspaceId, action, changes).catch(mapWorkspaceContentError),
  )
  registerValidatedHandler(
    workspaceDiffReadContract,
    isTrustedSender,
    ({ workspaceId, path, stage, commit }) =>
      contentService.readDiff(workspaceId, path, stage, commit).catch(mapWorkspaceContentError),
  )
  registerValidatedHandler(workspaceFileMediaContract, isTrustedSender, ({ workspaceId, path }) =>
    contentService.previewMedia(workspaceId, path).catch(mapWorkspaceContentError))
  registerValidatedHandler(workspaceFilesExistContract, isTrustedSender, ({ workspaceId, paths }) =>
    contentService.existingFiles(workspaceId, paths).catch(mapWorkspaceContentError))
  registerValidatedHandler(workspaceFileRevealContract, isTrustedSender, async ({ workspaceId, path }) => {
    // The renderer names a project file; main resolves and checks where it is.
    const target = await contentService.locateFile(workspaceId, path).catch(mapWorkspaceContentError)
    shell.showItemInFolder(target)
    return { workspaceId }
  })
  registerValidatedHandler(workspaceDiffListCommitsContract, isTrustedSender, ({ workspaceId }) =>
    contentService.listCommits(workspaceId).catch(mapWorkspaceContentError))
  registerValidatedHandler(workspaceDiffListCommitContract, isTrustedSender, ({ workspaceId, commit }) =>
    contentService.listCommitChanges(workspaceId, commit).catch(mapWorkspaceContentError))
  registerValidatedHandler(workspaceDiffSidesContract, isTrustedSender, ({ workspaceId, path, previousPath, stage, commit }) =>
    contentService.readDiffSides(workspaceId, path, stage, commit, previousPath).catch(mapWorkspaceContentError))
  registerValidatedHandler(workspaceGitStatusContract, isTrustedSender, ({ workspaceId }) =>
    contentService.gitStatus(workspaceId).catch(mapWorkspaceContentError))
  registerValidatedHandler(workspaceGitCommitContract, isTrustedSender, ({ workspaceId, request }) =>
    contentService.commit(workspaceId, request).catch(mapWorkspaceContentError))
  registerValidatedHandler(workspaceGitSuggestMessageContract, isTrustedSender, async ({ workspaceId, providerId, modelId, includeUnstaged, locale }) => {
    if (!completeText) throw new MainProcessError('COMMIT_MESSAGE_UNAVAILABLE', 'Commit messages cannot be suggested here.')
    const preview = await contentService.commitPreview(workspaceId, includeUnstaged).catch(mapWorkspaceContentError)
    if (!preview) throw new MainProcessError('WORKSPACE_NOTHING_TO_COMMIT', 'There is nothing to commit.')
    const language = locale === 'zh-CN' ? 'Chinese' : 'English'
    let message: string
    try {
      message = cleanCommitMessage(await completeText({
        providerId,
        modelId,
        systemPrompt: `${COMMIT_MESSAGE_PROMPT}\nWithout recent commits to follow, write in ${language}.`,
        prompt: preview,
        maxTokens: 400,
      }))
    } catch {
      throw new MainProcessError('COMMIT_MESSAGE_FAILED', 'The model could not write a commit message.')
    }
    if (!message) throw new MainProcessError('COMMIT_MESSAGE_FAILED', 'The model returned an empty message.')
    return { workspaceId, message: message.slice(0, 20_000) }
  })
  registerValidatedHandler(editorsListContract, isTrustedSender, async () => ({ editors: await editors.list() }))
  registerValidatedHandler(editorsOpenContract, isTrustedSender, async ({ workspaceId, editorId, path, line }) => {
    // The renderer names a project file; main resolves it inside the project before launching anything.
    const target = await contentService.locateFile(workspaceId, path ?? '.').catch(mapWorkspaceContentError)
    try {
      await editors.open(editorId, target, line, !path)
    } catch {
      throw new MainProcessError('EDITOR_OPEN_FAILED', 'The editor could not be opened.')
    }
    return { workspaceId }
  })
  repository.subscribe((snapshot) => {
    const window = getMainWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(
      ipcChannels.workspaceChanged,
      workspaceChangedEventSchema.parse({ eventId: randomUUID(), snapshot }),
    )
  })
}
