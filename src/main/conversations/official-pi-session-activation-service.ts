import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import {
  conversationActivationResultSchema,
  conversationScopeSchema,
  type ConversationActivationResult,
  type ConversationScope,
  type SessionCatalogSelectionToken,
} from '../../shared/conversation-scope'
import type {
  LocalPiRpcCommandType,
  LocalPiRuntimeSnapshot,
  LocalPiSessionState,
} from '../../shared/local-pi'
import type {
  PiRuntimeFrontend,
  PiRuntimeSelectionIdentity,
} from '../pi-host/pi-runtime-frontend'
import type { ObservedPiSessionDirectoryRepository } from '../repositories/observed-pi-session-directory-repository'
import {
  conversationScopeKey,
  type ConversationScopeResolver,
} from './conversation-scope-resolver'
import {
  currentOfficialPiSessionHeaderSchema,
  type OfficialPiSessionCatalog,
} from './official-pi-session-catalog'

const CATALOG_MUTATING_COMMANDS = new Set<LocalPiRpcCommandType>([
  'new_session',
  'set_session_name',
  'fork',
  'clone',
])
const SESSION_CHANGING_COMMANDS = new Set<LocalPiRpcCommandType>([
  'new_session',
  'fork',
  'clone',
])
const MAX_SESSION_HEADER_BYTES = 64 * 1_024

type SessionRuntimeHost = Pick<
  PiRuntimeFrontend,
  | 'getActiveRuntimeIdentity'
  | 'getSnapshot'
  | 'getState'
  | 'renameSession'
  | 'replace'
  | 'rollbackSelection'
  | 'start'
  | 'stop'
>

interface ActiveRuntimeScope {
  generation: number
  runtimeId: string
  selectionRevision: number
  scope: ConversationScope
}

async function readCurrentSessionHeader(sessionFile: string) {
  const handle = await open(sessionFile, 'r')
  try {
    const details = await handle.stat()
    if (!details.isFile() || details.size <= 0) {
      throw new Error('The recovered session file is invalid.')
    }
    const readLength = Math.min(details.size, MAX_SESSION_HEADER_BYTES + 1)
    const buffer = Buffer.alloc(readLength)
    const { bytesRead } = await handle.read(buffer, 0, readLength, 0)
    const bytes = buffer.subarray(0, bytesRead)
    let lineEnd = bytes.indexOf(0x0a)
    if (lineEnd === -1) {
      if (details.size > MAX_SESSION_HEADER_BYTES) {
        throw new Error('The recovered session header is too large.')
      }
      lineEnd = bytes.length
    }
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const decoded = decoder.decode(bytes.subarray(0, lineEnd))
    const line = decoded.endsWith('\r') ? decoded.slice(0, -1) : decoded
    return currentOfficialPiSessionHeaderSchema.parse(JSON.parse(line) as unknown)
  } finally {
    await handle.close().catch(() => undefined)
  }
}

export type OfficialPiSessionActivationErrorCode =
  | 'PI_SESSION_ACTIVATION_UNAVAILABLE'
  | 'PI_SESSION_CONFIRMATION_FAILED'

export class OfficialPiSessionActivationError extends Error {
  constructor(
    readonly code: OfficialPiSessionActivationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'OfficialPiSessionActivationError'
  }
}

export class OfficialPiSessionActivationService {
  private activeRuntimeScope: ActiveRuntimeScope | null = null
  private activationLifecycle: Promise<void> = Promise.resolve()

  constructor(
    private readonly scopeResolver: ConversationScopeResolver,
    private readonly observedDirectories: ObservedPiSessionDirectoryRepository,
    private readonly catalog: OfficialPiSessionCatalog,
    private readonly runtimeHost: SessionRuntimeHost,
  ) {}

  start(rawScope: ConversationScope) {
    const scope = conversationScopeSchema.parse(rawScope)
    return this.enqueueActivation(() => this.startInternal(scope))
  }

  private async startInternal(scope: ConversationScope) {
    await this.scopeResolver.prepare(scope)
    let snapshot: LocalPiRuntimeSnapshot
    try {
      snapshot = await this.runtimeHost.start({ scope })
    } catch (error) {
      this.reconcileActiveRuntimeScope()
      throw error
    }
    this.activeRuntimeScope = this.requireActiveRuntimeScope(scope, snapshot)
    await this.recordActivation(scope, snapshot.sessionState ?? undefined)
    return snapshot
  }

  open(
    rawScope: ConversationScope,
    selectionToken: SessionCatalogSelectionToken,
  ): Promise<ConversationActivationResult> {
    const scope = conversationScopeSchema.parse(rawScope)
    return this.enqueueActivation(() =>
      this.openInternal(scope, selectionToken))
  }

  private async openInternal(
    scope: ConversationScope,
    selectionToken: SessionCatalogSelectionToken,
  ): Promise<ConversationActivationResult> {
    const selection = await this.catalog.resolve(scope, selectionToken)
    let snapshot: LocalPiRuntimeSnapshot
    try {
      snapshot = await this.runtimeHost.replace(
        selection.mode === 'recover'
          ? {
              forkSessionFile: selection.forkSessionFile,
              scope,
              selectionToken,
            }
          : {
              sessionFile: selection.sessionFile,
              scope,
              selectionToken,
            },
      )
    } catch {
      this.reconcileActiveRuntimeScope()
      throw new OfficialPiSessionActivationError(
        'PI_SESSION_CONFIRMATION_FAILED',
        'Pi could not open the selected session.',
      )
    }
    const activatedRuntime = this.requireActiveRuntimeScope(scope, snapshot)
    this.activeRuntimeScope = activatedRuntime

    try {
      const activatedSessionId = selection.mode === 'recover'
        ? await this.confirmRecovery(
            snapshot,
            selection.cwd,
            selection.sessionId,
            selection.forkSessionFile,
          )
        : await this.confirmSelection(
            snapshot,
            selection.sessionId,
            selection.sessionFile,
          )
      const observation = await this.recordActivation(
        scope,
        snapshot.sessionState ?? undefined,
      )
      if (observation !== 'observed') {
        throw new OfficialPiSessionActivationError(
          'PI_SESSION_ACTIVATION_UNAVAILABLE',
          'Pi did not report a persisted session file for the selected session.',
        )
      }
      return conversationActivationResultSchema.parse({
        scope,
        sessionId: activatedSessionId,
        generation: snapshot.generation,
      })
    } catch (error) {
      if (this.isActive(activatedRuntime)) {
        await this.runtimeHost.rollbackSelection(activatedRuntime).catch(() => false)
        this.reconcileActiveRuntimeScope()
      }
      if (error instanceof OfficialPiSessionActivationError) throw error
      throw new OfficialPiSessionActivationError(
        'PI_SESSION_CONFIRMATION_FAILED',
        'Pi did not confirm the selected session.',
      )
    }
  }

  getActiveScope() {
    const active = this.getCurrentActiveRuntimeScope()
    return active
      ? structuredClone(active.scope)
      : null
  }

  stop() {
    return this.enqueueActivation(async () => {
      try {
        return await this.runtimeHost.stop()
      } finally {
        this.activeRuntimeScope = null
      }
    })
  }

  rename(
    rawScope: ConversationScope,
    selectionToken: SessionCatalogSelectionToken,
    rawName: string,
  ) {
    const scope = conversationScopeSchema.parse(rawScope)
    const name = rawName.replace(/[\r\n]+/gu, ' ').trim()
    if (!name) {
      throw new OfficialPiSessionActivationError(
        'PI_SESSION_CONFIRMATION_FAILED',
        'Session name cannot be empty.',
      )
    }
    return this.enqueueActivation(async () => {
      const selection = await this.catalog.resolve(scope, selectionToken)
      if (selection.mode !== 'open') {
        throw new OfficialPiSessionActivationError(
          'PI_SESSION_ACTIVATION_UNAVAILABLE',
          'Recover the moved session before renaming it.',
        )
      }
      const renamed = await this.runtimeHost.renameSession(
        scope,
        selection.sessionFile,
        name,
      )
      if (renamed.sessionId !== selection.sessionId) {
        throw new OfficialPiSessionActivationError(
          'PI_SESSION_CONFIRMATION_FAILED',
          'Pi renamed another session.',
        )
      }
      this.catalog.invalidate(scope)
      return {
        scope,
        sessionId: selection.sessionId,
        name: renamed.name,
      }
    })
  }

  async afterSuccessfulCommand(
    commandType: LocalPiRpcCommandType,
    sourceIdentity: PiRuntimeSelectionIdentity | null,
    resultIdentity: PiRuntimeSelectionIdentity | null,
  ) {
    if (!CATALOG_MUTATING_COMMANDS.has(commandType)) return
    const active = this.activeRuntimeScope
    if (!active || !sourceIdentity || !this.sameRuntime(active, sourceIdentity)) return

    const snapshot = this.runtimeHost.getSnapshot()
    if (
      snapshot.state !== 'ready' ||
      !resultIdentity ||
      resultIdentity.runtimeId !== sourceIdentity.runtimeId
    ) {
      return
    }
    if (resultIdentity.generation !== sourceIdentity.generation) {
      if (!SESSION_CHANGING_COMMANDS.has(commandType)) return
      this.activeRuntimeScope = {
        generation: resultIdentity.generation,
        runtimeId: resultIdentity.runtimeId,
        selectionRevision: resultIdentity.selectionRevision,
        scope: active.scope,
      }
    }

    const current = this.getCurrentActiveRuntimeScope(resultIdentity)
    if (!current) return
    this.catalog.invalidate(current.scope)
    try {
      const state = await this.runtimeHost.getState()
      if (!this.isActive(current)) return
      await this.recordActivation(current.scope, state)
    } catch {
      // Metadata refresh is best effort, but a session-changing command must
      // publish its authoritative state so the renderer can finish hydration.
      if (SESSION_CHANGING_COMMANDS.has(commandType)) {
        throw new OfficialPiSessionActivationError(
          'PI_SESSION_CONFIRMATION_FAILED',
          'Pi changed the session but did not confirm its new state.',
        )
      }
    }
  }

  async onAgentSettled(runtimeId: string, generation: number) {
    const active = this.getCurrentActiveRuntimeScope({
      runtimeId,
      generation,
    })
    if (!active) return
    this.catalog.invalidate(active.scope)
    try {
      const state = await this.runtimeHost.getState()
      if (!this.isActive(active)) return
      await this.recordActivation(active.scope, state)
    } catch {
      // Settled notifications race controlled replacement. Cache invalidation
      // is still valid, while the prior observation remains usable.
    }
  }

  onSessionCatalogChanged(runtimeId: string, generation: number) {
    const active = this.getCurrentActiveRuntimeScope({
      runtimeId,
      generation,
    })
    if (!active) return
    this.catalog.invalidate(active.scope)
  }

  private async recordActivation(
    scope: ConversationScope,
    state: LocalPiSessionState | undefined,
  ) {
    const result = await this.observedDirectories.observe(scope, state?.sessionFile)
    this.catalog.invalidate(scope)
    return result.status
  }

  private async confirmSelection(
    snapshot: LocalPiRuntimeSnapshot,
    expectedSessionId: string,
    expectedSessionFile: string,
  ) {
    const state = snapshot.sessionState
    if (
      snapshot.state !== 'ready' ||
      !state ||
      state.sessionId !== expectedSessionId ||
      !state.sessionFile ||
      !isAbsolute(state.sessionFile)
    ) {
      throw new OfficialPiSessionActivationError(
        'PI_SESSION_CONFIRMATION_FAILED',
        'Pi did not confirm the selected session.',
      )
    }

    try {
      const directDetails = await lstat(resolve(state.sessionFile))
      const canonicalFile = await realpath(resolve(state.sessionFile))
      if (
        !directDetails.isFile() ||
        directDetails.isSymbolicLink() ||
        canonicalFile !== expectedSessionFile
      ) {
        throw new Error('The confirmed session file changed identity.')
      }
    } catch {
      throw new OfficialPiSessionActivationError(
        'PI_SESSION_CONFIRMATION_FAILED',
        'Pi did not confirm the selected session.',
      )
    }
    return expectedSessionId
  }

  private async confirmRecovery(
    snapshot: LocalPiRuntimeSnapshot,
    expectedCwd: string,
    sourceSessionId: string,
    sourceSessionFile: string,
  ) {
    const state = snapshot.sessionState
    if (
      snapshot.state !== 'ready' ||
      !state ||
      state.sessionId === sourceSessionId ||
      !state.sessionFile ||
      !isAbsolute(state.sessionFile)
    ) {
      throw new OfficialPiSessionActivationError(
        'PI_SESSION_CONFIRMATION_FAILED',
        'Pi did not confirm the recovered session.',
      )
    }

    try {
      const directFile = resolve(state.sessionFile)
      const directDetails = await lstat(directFile)
      const canonicalFile = await realpath(directFile)
      if (
        !directDetails.isFile() ||
        directDetails.isSymbolicLink() ||
        canonicalFile === sourceSessionFile
      ) {
        throw new Error('Pi did not create a distinct recovered session file.')
      }

      const header = await readCurrentSessionHeader(canonicalFile)
      if (
        header.id !== state.sessionId ||
        !isAbsolute(header.cwd) ||
        !header.parentSession ||
        !isAbsolute(header.parentSession)
      ) {
        throw new Error('The recovered session header is invalid.')
      }
      const [headerCwd, parentSession] = await Promise.all([
        realpath(resolve(header.cwd)),
        realpath(resolve(header.parentSession)),
      ])
      if (headerCwd !== expectedCwd || parentSession !== sourceSessionFile) {
        throw new Error('The recovered session header does not match its source.')
      }
    } catch {
      throw new OfficialPiSessionActivationError(
        'PI_SESSION_CONFIRMATION_FAILED',
        'Pi did not confirm the recovered session.',
      )
    }

    return state.sessionId
  }

  private enqueueActivation<T>(operation: () => Promise<T>) {
    const result = this.activationLifecycle.then(operation, operation)
    this.activationLifecycle = result.then(() => undefined, () => undefined)
    return result
  }

  private getCurrentActiveRuntimeScope(expected?: {
    runtimeId: string
    generation: number
  }) {
    const active = this.activeRuntimeScope
    const snapshot = this.runtimeHost.getSnapshot()
    const identity = this.runtimeHost.getActiveRuntimeIdentity()
    if (
      !active ||
      !identity ||
      snapshot.state !== 'ready' ||
      snapshot.generation !== active.generation ||
      !this.sameRuntime(active, identity) ||
      (
        expected !== undefined &&
        (
          active.runtimeId !== expected.runtimeId ||
          active.generation !== expected.generation
        )
      )
    ) {
      return null
    }
    return active
  }

  private isActive(expected: ActiveRuntimeScope) {
    const active = this.getCurrentActiveRuntimeScope()
    return Boolean(active && this.sameRuntime(active, expected))
  }

  private sameRuntime(
    left: ActiveRuntimeScope,
    right: Pick<
      PiRuntimeSelectionIdentity,
      'generation' | 'runtimeId' | 'selectionRevision' | 'scope'
    >,
  ) {
    return left.runtimeId === right.runtimeId &&
      left.generation === right.generation &&
      left.selectionRevision === right.selectionRevision &&
      conversationScopeKey(left.scope) === conversationScopeKey(right.scope)
  }

  private requireActiveRuntimeScope(
    scope: ConversationScope,
    snapshot: LocalPiRuntimeSnapshot,
  ): ActiveRuntimeScope {
    const identity = this.runtimeHost.getActiveRuntimeIdentity()
    if (
      !identity ||
      identity.generation !== snapshot.generation ||
      conversationScopeKey(identity.scope) !== conversationScopeKey(scope)
    ) {
      throw new OfficialPiSessionActivationError(
        'PI_SESSION_CONFIRMATION_FAILED',
        'Pi did not expose the selected runtime identity.',
      )
    }
    return {
      generation: identity.generation,
      runtimeId: identity.runtimeId,
      selectionRevision: identity.selectionRevision,
      scope,
    }
  }

  private reconcileActiveRuntimeScope() {
    if (!this.getCurrentActiveRuntimeScope()) this.activeRuntimeScope = null
  }
}
