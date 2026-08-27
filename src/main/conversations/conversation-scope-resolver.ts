import { lstat, mkdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import {
  conversationScopeSchema,
  type ConversationScope,
} from '../../shared/conversation-scope'

interface WorkspaceLocation {
  id: string
  name: string
  path: string
}

export interface WorkspaceLocationReader {
  getLocation(workspaceId: string): WorkspaceLocation | undefined
}

export type ConversationScopeErrorCode =
  | 'CONVERSATION_SCOPE_NOT_FOUND'
  | 'CONVERSATION_SCOPE_UNAVAILABLE'

export class ConversationScopeError extends Error {
  constructor(
    readonly code: ConversationScopeErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ConversationScopeError'
  }
}

export interface ResolvedConversationScope {
  scope: ConversationScope
  cwd: string
  label?: string
}

export function conversationScopeKey(rawScope: ConversationScope) {
  const scope = conversationScopeSchema.parse(rawScope)
  return scope.kind === 'project'
    ? `project:${scope.workspaceId}`
    : 'projectless'
}

async function canonicalDirectory(candidatePath: string) {
  if (!isAbsolute(candidatePath)) throw new Error('The path is not absolute.')
  const canonicalPath = await realpath(resolve(candidatePath))
  const details = await stat(canonicalPath)
  if (!details.isDirectory()) throw new Error('The path is not a directory.')
  return canonicalPath
}

export class ConversationScopeResolver {
  private readonly projectlessCwd: string

  constructor(
    private readonly workspaces: WorkspaceLocationReader,
    projectlessCwd: string,
  ) {
    if (!isAbsolute(projectlessCwd)) {
      throw new Error('The projectless conversation cwd must be absolute.')
    }
    this.projectlessCwd = resolve(projectlessCwd)
  }

  async resolve(rawScope: ConversationScope): Promise<ResolvedConversationScope> {
    const scope = conversationScopeSchema.parse(rawScope)
    if (scope.kind === 'project') {
      const location = this.workspaces.getLocation(scope.workspaceId)
      if (!location) {
        throw new ConversationScopeError(
          'CONVERSATION_SCOPE_NOT_FOUND',
          'The selected project is unavailable.',
        )
      }

      try {
        const cwd = await canonicalDirectory(location.path)
        if (cwd !== location.path) {
          throw new Error('The selected project path changed identity.')
        }
        return { scope, cwd, label: location.name }
      } catch {
        throw new ConversationScopeError(
          'CONVERSATION_SCOPE_UNAVAILABLE',
          'The selected project is unavailable.',
        )
      }
    }

    try {
      const directDetails = await lstat(this.projectlessCwd)
      if (directDetails.isSymbolicLink()) {
        throw new Error('The projectless conversation cwd is a symbolic link.')
      }
      return { scope, cwd: await canonicalDirectory(this.projectlessCwd) }
    } catch {
      throw new ConversationScopeError(
        'CONVERSATION_SCOPE_UNAVAILABLE',
        'The projectless conversation workspace is unavailable.',
      )
    }
  }

  async prepare(rawScope: ConversationScope) {
    const scope = conversationScopeSchema.parse(rawScope)
    if (scope.kind === 'projectless') {
      await mkdir(this.projectlessCwd, { recursive: true, mode: 0o700 })
    }
    return this.resolve(scope)
  }
}
