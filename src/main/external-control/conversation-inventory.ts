import { createHash, randomUUID } from 'node:crypto'
import {
  ExternalControlError,
  externalControlConversationIdSchema,
  getConversationStatusInputSchema,
  getConversationStatusResultSchema,
  listConversationsInputSchema,
  listConversationsResultSchema,
  type ExternalControlConversation,
} from '../../shared/external-control'
import type { ConversationScope } from '../../shared/conversation-scope'
import {
  conversationScopeKey,
} from '../conversations/conversation-scope-resolver'
import type {
  OfficialPiSessionCatalog,
  OfficialPiSessionControlTarget,
} from '../conversations/official-pi-session-catalog'
import type {
  PiRuntimeControlSummary,
  PiRuntimeFrontend,
} from '../pi-host/pi-runtime-frontend'
import type { WorkspaceRepository } from '../repositories/workspace-repository'
import type { ExternalControlIdentityRepository } from './identity-repository'

interface InventoryCursor {
  revision: string
  nextIndex: number
  boundaryConversationId: string
}

export interface ConversationMcpResolvedTarget {
  conversation: ExternalControlConversation
  catalogTarget?: OfficialPiSessionControlTarget
  runtime?: PiRuntimeControlSummary
}

export interface ConversationMcpInventoryOptions {
  createCursorId?: () => string
  now?: () => number
}

function sameScope(left: ConversationScope, right: ConversationScope) {
  return left.kind === right.kind && (
    left.kind === 'projectless' ||
    (right.kind === 'project' && left.workspaceId === right.workspaceId)
  )
}

export class ConversationMcpInventoryService {
  private readonly createCursorId: () => string
  private readonly now: () => number
  private readonly cursors = new Map<string, InventoryCursor>()
  private readonly runtimeFirstSeen = new Map<string, string>()

  constructor(
    private readonly workspaces: Pick<WorkspaceRepository, 'get'>,
    private readonly catalog: Pick<
      OfficialPiSessionCatalog,
      'listControlTargets' | 'revalidateControlTarget'
    >,
    private readonly runtimeFrontend: Pick<PiRuntimeFrontend, 'listControlRuntimes'>,
    private readonly identities: Pick<ExternalControlIdentityRepository, 'conversationId'>,
    options: ConversationMcpInventoryOptions = {},
  ) {
    this.createCursorId = options.createCursorId ?? (() => randomUUID().replace(/-/gu, ''))
    this.now = options.now ?? Date.now
  }

  async listConversations(rawInput: unknown) {
    const input = listConversationsInputSchema.parse(rawInput)
    const inventory = await this.scan()
    let startIndex = 0
    if (input.cursor) {
      const cursor = this.cursors.get(input.cursor)
      const boundary = cursor
        ? inventory.targets[cursor.nextIndex - 1]
        : undefined
      if (
        !cursor ||
        cursor.revision !== inventory.revision ||
        !boundary ||
        boundary.conversation.conversationId !== cursor.boundaryConversationId
      ) {
        throw new ExternalControlError(
          'invalid_state',
          'The conversation inventory cursor is stale.',
        )
      }
      startIndex = cursor.nextIndex
    }

    const endIndex = Math.min(startIndex + input.limit, inventory.targets.length)
    const page = inventory.targets.slice(startIndex, endIndex)
    let nextCursor: string | null = null
    if (endIndex < inventory.targets.length) {
      const boundary = inventory.targets[endIndex - 1]
      if (!boundary) throw new Error('The inventory page boundary is invalid.')
      nextCursor = `inv_${this.createCursorId()}`
      this.cursors.set(nextCursor, {
        revision: inventory.revision,
        nextIndex: endIndex,
        boundaryConversationId: boundary.conversation.conversationId,
      })
      while (this.cursors.size > 256) {
        const oldest = this.cursors.keys().next().value
        if (oldest === undefined) break
        this.cursors.delete(oldest)
      }
    }

    return listConversationsResultSchema.parse({
      conversations: page.map((entry) => entry.conversation),
      nextCursor,
      diagnostics: inventory.diagnostics,
    })
  }

  async getConversationStatus(rawInput: unknown) {
    const input = getConversationStatusInputSchema.parse(rawInput)
    const target = await this.resolveConversation(input.conversationId)
    return getConversationStatusResultSchema.parse({
      conversation: target.conversation,
    })
  }

  async resolveConversation(
    rawConversationId: string,
  ): Promise<ConversationMcpResolvedTarget> {
    const conversationId = externalControlConversationIdSchema.parse(rawConversationId)
    const inventory = await this.scan()
    const target = inventory.targets.find((entry) =>
      entry.conversation.conversationId === conversationId)
    if (!target) {
      throw new ExternalControlError(
        'conversation_not_found',
        'The PiPilot conversation was not found.',
      )
    }
    return structuredClone(target)
  }

  async revalidateTarget(
    target: ConversationMcpResolvedTarget,
  ): Promise<ConversationMcpResolvedTarget> {
    if (target.catalogTarget) {
      try {
        await this.catalog.revalidateControlTarget(target.catalogTarget)
      } catch {
        throw new ExternalControlError(
          'conversation_unavailable',
          'The PiPilot conversation changed or is unavailable.',
        )
      }
      return structuredClone(target)
    }

    const current = this.runtimeFrontend.listControlRuntimes().find((runtime) =>
      target.runtime !== undefined &&
      runtime.runtimeId === target.runtime.runtimeId &&
      runtime.generation === target.runtime.generation &&
      runtime.sessionId === target.runtime.sessionId &&
      runtime.sessionFile === target.runtime.sessionFile &&
      sameScope(runtime.scope, target.runtime.scope))
    if (!current) {
      throw new ExternalControlError(
        'conversation_unavailable',
        'The PiPilot conversation Runtime was replaced or stopped.',
      )
    }
    return { ...structuredClone(target), runtime: current }
  }

  private async scan() {
    const workspaceSnapshot = this.workspaces.get()
    const workspaceLabels = new Map(
      workspaceSnapshot.recent.map((workspace) => [workspace.id, workspace.name]),
    )
    const scopes: ConversationScope[] = [
      { kind: 'projectless' },
      ...workspaceSnapshot.recent
        .filter((workspace) => workspace.available)
        .map((workspace): ConversationScope => ({
          kind: 'project',
          workspaceId: workspace.id,
        })),
    ]
    const diagnostics: Array<{
      scope: string
      status: 'not_loaded' | 'unavailable'
    }> = workspaceSnapshot.recent
      .filter((workspace) => !workspace.available)
      .map((workspace) => ({ scope: workspace.name, status: 'unavailable' as const }))
    const targetsById = new Map<string, ConversationMcpResolvedTarget>()
    const catalogRevisions: Array<[string, number, string]> = []

    for (const scope of scopes) {
      const project = scope.kind === 'project'
        ? workspaceLabels.get(scope.workspaceId)
        : undefined
      let result: Awaited<ReturnType<OfficialPiSessionCatalog['listControlTargets']>>
      try {
        result = await this.catalog.listControlTargets(scope)
      } catch {
        diagnostics.push({
          scope: project ?? 'Projectless',
          status: 'unavailable',
        })
        catalogRevisions.push([conversationScopeKey(scope), -1, 'unavailable'])
        continue
      }
      catalogRevisions.push([
        conversationScopeKey(scope),
        result.revision,
        result.status,
      ])
      if (result.status !== 'ready') {
        diagnostics.push({
          scope: project ?? 'Projectless',
          status: result.status === 'notLoaded' ? 'not_loaded' : 'unavailable',
        })
        continue
      }

      for (const target of result.targets) {
        const conversationId = this.identities.conversationId(
          conversationScopeKey(scope),
          target.sessionFile,
        )
        targetsById.set(conversationId, {
          conversation: {
            conversationId,
            ...(target.name ? { name: target.name } : {}),
            ...(project ? { project } : {}),
            createdAt: target.createdAt,
            modifiedAt: target.modifiedAt,
            lifecycle: 'inactive',
          },
          catalogTarget: structuredClone(target),
        })
      }
    }

    const runtimes = this.runtimeFrontend.listControlRuntimes()
    const seenRuntimeConversationIds = new Set<string>()
    for (const runtime of runtimes) {
      if (!runtime.sessionFile) continue
      const conversationId = this.identities.conversationId(
        conversationScopeKey(runtime.scope),
        runtime.sessionFile,
      )
      seenRuntimeConversationIds.add(conversationId)
      const existing = targetsById.get(conversationId)
      const firstSeen = this.runtimeFirstSeen.get(conversationId) ??
        new Date(this.now()).toISOString()
      this.runtimeFirstSeen.set(conversationId, firstSeen)
      const project = runtime.scope.kind === 'project'
        ? workspaceLabels.get(runtime.scope.workspaceId)
        : undefined
      const runtimeFields = {
        lifecycle: runtime.lifecycle,
        queueCount: runtime.queueCount,
        ...(runtime.activity ? { activity: runtime.activity } : {}),
      } as const
      if (existing) {
        existing.runtime = structuredClone(runtime)
        existing.conversation = {
          ...existing.conversation,
          ...runtimeFields,
        }
      } else {
        targetsById.set(conversationId, {
          conversation: {
            conversationId,
            ...(project ? { project } : {}),
            createdAt: firstSeen,
            modifiedAt: firstSeen,
            ...runtimeFields,
          },
          runtime: structuredClone(runtime),
        })
      }
    }
    for (const conversationId of this.runtimeFirstSeen.keys()) {
      if (!seenRuntimeConversationIds.has(conversationId)) {
        this.runtimeFirstSeen.delete(conversationId)
      }
    }

    const targets = [...targetsById.values()].sort((left, right) => {
      const modified = right.conversation.modifiedAt.localeCompare(
        left.conversation.modifiedAt,
      )
      return modified || left.conversation.conversationId.localeCompare(
        right.conversation.conversationId,
      )
    })
    const revision = createHash('sha256').update(JSON.stringify([
      workspaceSnapshot.revision,
      catalogRevisions,
      targets.map((target) => target.conversation),
    ])).digest('base64url')

    return { diagnostics, revision, targets }
  }
}
