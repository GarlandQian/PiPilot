import {
  conversationActivationResultSchema,
  conversationScopeSchema,
  type ConversationActivationResult,
  type ConversationScope,
  type SessionCatalogSelectionToken,
} from '../../shared/conversation-scope'
import type { LocalPiRuntimeSnapshot } from '../../shared/local-pi'
import type { ConversationNavigationRepository } from '../repositories/conversation-navigation-repository'
import {
  ConversationScopeError,
  conversationScopeKey,
  type ConversationScopeResolver,
} from './conversation-scope-resolver'
import { OfficialPiSessionActivationError, type OfficialPiSessionActivationService } from './official-pi-session-activation-service'
import type { OfficialPiSessionDeletionService } from './official-pi-session-deletion-service'

type SessionActivationService = Pick<
  OfficialPiSessionActivationService,
  'open' | 'rename' | 'start'
>

type SessionDeletionService = Pick<OfficialPiSessionDeletionService, 'delete'>

interface ConversationContextServiceOptions {
  activationService: SessionActivationService
  deletionService: SessionDeletionService
  navigationRepository: ConversationNavigationRepository
  scopeResolver: ConversationScopeResolver
  disposeScope?(scope: ConversationScope): Promise<void>
  onScopeDisposalError?(): void
}

export class ConversationContextService {
  private lifecycle: Promise<void> = Promise.resolve()
  private readonly activationService: SessionActivationService
  private readonly deletionService: SessionDeletionService
  private readonly navigationRepository: ConversationNavigationRepository
  private readonly scopeResolver: ConversationScopeResolver
  private readonly disposeScope: (scope: ConversationScope) => Promise<void>
  private readonly onScopeDisposalError: () => void

  constructor(options: ConversationContextServiceOptions) {
    this.activationService = options.activationService
    this.deletionService = options.deletionService
    this.navigationRepository = options.navigationRepository
    this.scopeResolver = options.scopeResolver
    this.disposeScope = options.disposeScope ?? (async () => undefined)
    this.onScopeDisposalError = options.onScopeDisposalError ?? (() => undefined)
  }

  getSnapshot() {
    return this.navigationRepository.get()
  }

  subscribe(
    listener: Parameters<ConversationNavigationRepository['subscribe']>[0],
  ) {
    return this.navigationRepository.subscribe(listener)
  }

  start() {
    return this.enqueue(async () => {
      const persistedScope = this.navigationRepository.get().activeScope
      const scope = await this.availableStartupScope(persistedScope)
      const runtime = await this.activationService.start(scope)
      this.confirmedActivation(scope, runtime)
      this.navigationRepository.setActiveScope(scope)
      return runtime
    })
  }

  newConversation(
    rawScope: ConversationScope,
  ): Promise<ConversationActivationResult> {
    const scope = conversationScopeSchema.parse(rawScope)
    return this.enqueue(async () => {
      const previousScope = this.navigationRepository.get().activeScope
      const runtime = await this.activationService.start(scope)
      const result = this.confirmedActivation(scope, runtime)
      await this.commitScope(scope, previousScope)
      return result
    })
  }

  openConversation(
    rawScope: ConversationScope,
    selectionToken: SessionCatalogSelectionToken,
  ) {
    const scope = conversationScopeSchema.parse(rawScope)
    return this.enqueue(async () => {
      const previousScope = this.navigationRepository.get().activeScope
      const result = await this.activationService.open(
        scope,
        selectionToken,
      )
      await this.commitScope(scope, previousScope)
      return result
    })
  }

  deleteConversation(
    rawScope: ConversationScope,
    selectionToken: SessionCatalogSelectionToken,
  ) {
    const scope = conversationScopeSchema.parse(rawScope)
    return this.enqueue(() => this.deletionService.delete(scope, selectionToken))
  }

  renameConversation(
    rawScope: ConversationScope,
    selectionToken: SessionCatalogSelectionToken,
    name: string,
  ) {
    const scope = conversationScopeSchema.parse(rawScope)
    return this.enqueue(() =>
      this.activationService.rename(scope, selectionToken, name))
  }

  private confirmedActivation(scope: ConversationScope, runtime: LocalPiRuntimeSnapshot) {
    const result = conversationActivationResultSchema.safeParse({
      scope,
      generation: runtime.generation,
      sessionId: runtime.sessionState?.sessionId,
    })
    if (runtime.state !== 'ready' || !result.success) {
      throw new OfficialPiSessionActivationError(
        'PI_SESSION_CONFIRMATION_FAILED',
        'Pi did not confirm the activated conversation.',
      )
    }
    return result.data
  }

  private async commitScope(scope: ConversationScope, previousScope: ConversationScope) {
    this.navigationRepository.setActiveScope(scope)
    if (conversationScopeKey(previousScope) === conversationScopeKey(scope)) return
    try {
      await this.disposeScope(previousScope)
    } catch {
      // Activation is already committed. Cleanup cannot restore the old scope.
      try { this.onScopeDisposalError() } catch { /* isolate diagnostics */ }
    }
  }

  private async availableStartupScope(scope: ConversationScope) {
    try {
      await this.scopeResolver.prepare(scope)
      return scope
    } catch (error) {
      if (
        scope.kind !== 'project' ||
        !(error instanceof ConversationScopeError)
      ) {
        throw error
      }
      const fallback = { kind: 'projectless' } as const
      await this.scopeResolver.prepare(fallback)
      return fallback
    }
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const result = this.lifecycle.then(operation, operation)
    this.lifecycle = result.then(() => undefined, () => undefined)
    return result
  }
}
