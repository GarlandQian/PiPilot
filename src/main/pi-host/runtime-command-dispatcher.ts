import { mkdir } from 'node:fs/promises'
import type { AgentSessionRuntime } from '@earendil-works/pi-coding-agent'
import type {
  ExternalControlAcceptedMode,
  ExternalControlRequestedMode,
} from '../../shared/external-control-mode'
import {
  LOCAL_PI_COMMAND_ARGUMENT_COMPLETION_MAX_ITEMS,
  localPiCommandArgumentCompletionSchema,
  localPiRpcResponseSchema,
  type LocalPiCommandArgumentCompletion,
  type LocalPiRpcCommand,
  type LocalPiRpcEvent,
  type LocalPiRpcResponse,
} from '../../shared/local-pi'

export const RUNTIME_COMMAND_ARGUMENT_COMPLETION_TIMEOUT_MS = 2_000

export interface RuntimeDispatchResult {
  replaced: boolean
  response: LocalPiRpcResponse
}

export interface RuntimeDispatchContext {
  emitEvent?(event: LocalPiRpcEvent): void
}

export interface RuntimeExternalSubmitCommand {
  message: string
  mode: ExternalControlRequestedMode
}

export interface RuntimeExternalSubmitResult {
  acceptedMode: ExternalControlAcceptedMode
}

export class RuntimeExternalSubmitError extends Error {
  readonly code = 'RUNTIME_EXTERNAL_SUBMIT_INVALID_STATE'

  constructor(message: string) {
    super(message)
    this.name = 'RuntimeExternalSubmitError'
  }
}

export async function ensureRuntimeSessionDirectory(session: {
  sessionManager: { getSessionDir(): string }
}) {
  await mkdir(session.sessionManager.getSessionDir(), {
    recursive: true,
    mode: 0o700,
  })
}

function successResponse(response: unknown): LocalPiRpcResponse {
  return localPiRpcResponseSchema.parse(response)
}

function failedResponse(command: string, error: unknown): LocalPiRpcResponse {
  const message = error instanceof Error ? error.message : String(error)
  return localPiRpcResponseSchema.parse({
    type: 'response',
    command,
    success: false,
    error: message.slice(0, 2_048),
  })
}

function noDataSuccess(command: LocalPiRpcCommand['type']) {
  return successResponse({ type: 'response', command, success: true })
}

function getState(runtime: AgentSessionRuntime): LocalPiRpcResponse {
  const { session } = runtime
  return successResponse({
    type: 'response',
    command: 'get_state',
    success: true,
    data: {
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      steeringMode: session.steeringMode,
      followUpMode: session.followUpMode,
      sessionFile: session.sessionFile,
      sessionId: session.sessionId,
      sessionName: session.sessionName,
      autoCompactionEnabled: session.autoCompactionEnabled,
      messageCount: session.messages.length,
      pendingMessageCount: session.pendingMessageCount,
    },
  })
}

function getMessages(runtime: AgentSessionRuntime): LocalPiRpcResponse {
  return successResponse({
    type: 'response',
    command: 'get_messages',
    success: true,
    data: { messages: runtime.session.messages },
  })
}

function getCommands(runtime: AgentSessionRuntime): LocalPiRpcResponse {
  const { session } = runtime
  const commands: Array<{
    name: string
    description?: string
    source: 'extension' | 'prompt' | 'skill'
    sourceInfo: {
      path: string
      source: string
      scope: 'user' | 'project' | 'temporary'
      origin: 'package' | 'top-level'
      baseDir?: string
    }
    hasArgumentCompletions?: boolean
  }> = []

  for (const command of session.extensionRunner.getRegisteredCommands()) {
    commands.push({
      name: command.invocationName,
      ...(command.description === undefined ? {} : { description: command.description }),
      source: 'extension',
      sourceInfo: { ...command.sourceInfo },
      ...(typeof command.getArgumentCompletions === 'function'
        ? { hasArgumentCompletions: true }
        : {}),
    })
  }
  for (const template of session.promptTemplates) {
    commands.push({
      name: template.name,
      ...(template.description === undefined ? {} : { description: template.description }),
      source: 'prompt',
      sourceInfo: { ...template.sourceInfo },
    })
  }
  for (const skill of session.resourceLoader.getSkills().skills) {
    commands.push({
      name: `skill:${skill.name}`,
      ...(skill.description === undefined ? {} : { description: skill.description }),
      source: 'skill',
      sourceInfo: { ...skill.sourceInfo },
    })
  }

  return successResponse({
    type: 'response',
    command: 'get_commands',
    success: true,
    data: { commands },
  })
}

class RuntimeCommandArgumentCompletionTimeoutError extends Error {}

export interface RuntimeCommandArgumentCompletionOptions {
  timeoutMs?: number
}

export async function getRuntimeCommandArgumentCompletions(
  runtime: AgentSessionRuntime,
  command: Extract<LocalPiRpcCommand, { type: 'get_command_argument_completions' }>,
  options: RuntimeCommandArgumentCompletionOptions = {},
): Promise<LocalPiCommandArgumentCompletion[]> {
  const registeredCommand = runtime.session.extensionRunner.getCommand(command.commandName)
  const provider = registeredCommand?.getArgumentCompletions
  if (!provider) return []

  let providerResult: Promise<unknown>
  try {
    providerResult = Promise.resolve(provider.call(registeredCommand, command.argumentPrefix))
  } catch {
    throw new Error('The extension command could not provide argument completions.')
  }

  const timeoutMs = options.timeoutMs ?? RUNTIME_COMMAND_ARGUMENT_COMPLETION_TIMEOUT_MS
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      providerResult,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new RuntimeCommandArgumentCompletionTimeoutError())
        }, Math.max(1, timeoutMs))
        timeout.unref()
      }),
    ])
    if (!Array.isArray(result)) return []

    const items: LocalPiCommandArgumentCompletion[] = []
    const inspectedCount = Math.min(
      result.length,
      LOCAL_PI_COMMAND_ARGUMENT_COMPLETION_MAX_ITEMS,
    )
    for (let index = 0; index < inspectedCount; index += 1) {
      const candidate = result[index]
      const parsed = localPiCommandArgumentCompletionSchema.safeParse(candidate)
      if (!parsed.success) continue
      items.push(parsed.data)
    }
    return items
  } catch (error) {
    if (error instanceof RuntimeCommandArgumentCompletionTimeoutError) {
      throw new Error('The extension command argument completion timed out.')
    }
    throw new Error('The extension command could not provide argument completions.')
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function dispatchPrompt(
  runtime: AgentSessionRuntime,
  command: Extract<LocalPiRpcCommand, { type: 'prompt' }>,
): Promise<RuntimeDispatchResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (response: LocalPiRpcResponse) => {
      if (settled) return
      settled = true
      resolve({ replaced: false, response })
    }
    void runtime.session.prompt(command.message, {
      images: command.images,
      streamingBehavior: command.streamingBehavior,
      source: 'rpc',
      preflightResult: (accepted) => {
        if (accepted) finish(noDataSuccess('prompt'))
      },
    }).then(
      () => finish(noDataSuccess('prompt')),
      (error: unknown) => finish(failedResponse('prompt', error)),
    )
  })
}

function acceptExternalPrompt(
  runtime: AgentSessionRuntime,
  message: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const accept = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const rejectPreflight = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error)
    }
    void runtime.session.prompt(message, {
      source: 'rpc',
      preflightResult: (accepted) => {
        if (accepted) accept()
        else rejectPreflight(new RuntimeExternalSubmitError(
          'Pi rejected the prompt before submission.',
        ))
      },
    }).then(
      // The pinned SDK invokes preflightResult for every handled, queued, or
      // normal Prompt. Retain resolution only as a compatibility assertion;
      // operation acceptance is expected to have settled in the callback.
      () => {
        if (!settled) {
          rejectPreflight(new RuntimeExternalSubmitError(
            'Pi completed prompt submission without an acceptance signal.',
          ))
        }
      },
      rejectPreflight,
    )
  })
}

/**
 * Performs the state decision and SDK submission in one Runtime command lane.
 * A separate get_state followed by send has a race with desktop submissions.
 */
export async function dispatchExternalSubmit(
  runtime: AgentSessionRuntime,
  command: RuntimeExternalSubmitCommand,
): Promise<RuntimeExternalSubmitResult> {
  await ensureRuntimeSessionDirectory(runtime.session)
  const running = runtime.session.isStreaming
  const acceptedMode = command.mode === 'auto'
    ? running ? 'follow_up' : 'prompt'
    : command.mode

  if (acceptedMode === 'prompt') {
    if (running) {
      throw new RuntimeExternalSubmitError(
        'A normal prompt cannot be submitted while the conversation is running.',
      )
    }
    await acceptExternalPrompt(runtime, command.message)
    return { acceptedMode }
  }
  if (!running) {
    throw new RuntimeExternalSubmitError(
      `${acceptedMode === 'steer' ? 'Steer' : 'Follow-up'} requires a running conversation.`,
    )
  }
  if (acceptedMode === 'steer') {
    await runtime.session.steer(command.message)
  } else {
    await runtime.session.followUp(command.message)
  }
  return { acceptedMode }
}

export async function dispatchRuntimeCommand(
  runtime: AgentSessionRuntime,
  command: LocalPiRpcCommand,
  context: RuntimeDispatchContext = {},
): Promise<RuntimeDispatchResult> {
  try {
    const { session } = runtime
    await ensureRuntimeSessionDirectory(session)
    switch (command.type) {
      case 'prompt':
        return dispatchPrompt(runtime, command)
      case 'steer':
        await session.steer(command.message, command.images)
        return { replaced: false, response: noDataSuccess('steer') }
      case 'follow_up':
        await session.followUp(command.message, command.images)
        return { replaced: false, response: noDataSuccess('follow_up') }
      case 'abort':
        await session.abort()
        return { replaced: false, response: noDataSuccess('abort') }
      case 'new_session': {
        const result = await runtime.newSession(
          command.parentSession === undefined
            ? undefined
            : { parentSession: command.parentSession },
        )
        return {
          replaced: !result.cancelled,
          response: successResponse({
            type: 'response',
            command: 'new_session',
            success: true,
            data: result,
          }),
        }
      }
      case 'get_state':
        return { replaced: false, response: getState(runtime) }
      case 'set_model': {
        const model = session.modelRuntime.getAvailableSnapshot().find(
          (candidate) => candidate.provider === command.provider &&
            candidate.id === command.modelId,
        )
        if (!model) {
          return {
            replaced: false,
            response: failedResponse(
              'set_model',
              `Model not found: ${command.provider}/${command.modelId}`,
            ),
          }
        }
        await session.setModel(model)
        return {
          replaced: false,
          response: successResponse({
            type: 'response',
            command: 'set_model',
            success: true,
            data: model,
          }),
        }
      }
      case 'cycle_model': {
        const result = await session.cycleModel()
        return {
          replaced: false,
          response: successResponse({
            type: 'response',
            command: 'cycle_model',
            success: true,
            data: result ?? null,
          }),
        }
      }
      case 'get_available_models':
        return {
          replaced: false,
          response: successResponse({
            type: 'response',
            command: 'get_available_models',
            success: true,
            data: { models: [...session.modelRuntime.getAvailableSnapshot()] },
          }),
        }
      case 'set_thinking_level':
        session.setThinkingLevel(command.level)
        return { replaced: false, response: noDataSuccess('set_thinking_level') }
      case 'cycle_thinking_level': {
        const level = session.cycleThinkingLevel()
        return {
          replaced: false,
          response: successResponse({
            type: 'response',
            command: 'cycle_thinking_level',
            success: true,
            data: level === undefined ? null : { level },
          }),
        }
      }
      case 'get_available_thinking_levels':
        return {
          replaced: false,
          response: successResponse({
            type: 'response',
            command: 'get_available_thinking_levels',
            success: true,
            data: { levels: session.getAvailableThinkingLevels() },
          }),
        }
      case 'set_steering_mode':
        session.setSteeringMode(command.mode)
        return { replaced: false, response: noDataSuccess('set_steering_mode') }
      case 'set_follow_up_mode':
        session.setFollowUpMode(command.mode)
        return { replaced: false, response: noDataSuccess('set_follow_up_mode') }
      case 'compact': {
        const result = await session.compact(command.customInstructions)
        return {
          replaced: false,
          response: successResponse({
            type: 'response',
            command: 'compact',
            success: true,
            data: result,
          }),
        }
      }
      case 'set_auto_compaction':
        session.setAutoCompactionEnabled(command.enabled)
        return { replaced: false, response: noDataSuccess('set_auto_compaction') }
      case 'set_auto_retry':
        session.setAutoRetryEnabled(command.enabled)
        return { replaced: false, response: noDataSuccess('set_auto_retry') }
      case 'abort_retry':
        session.abortRetry()
        return { replaced: false, response: noDataSuccess('abort_retry') }
      case 'bash': {
        const extensionResult = await session.extensionRunner.emitUserBash({
          type: 'user_bash',
          command: command.command,
          excludeFromContext: command.excludeFromContext ?? false,
          cwd: session.sessionManager.getCwd(),
        })
        const result = extensionResult?.result ?? await session.executeBash(
          command.command,
          (delta) => context.emitEvent?.({ type: 'bash_execution_update', delta }),
          {
            excludeFromContext: command.excludeFromContext,
            operations: extensionResult?.operations,
          },
        )
        if (extensionResult?.result) {
          session.recordBashResult(command.command, result, {
            excludeFromContext: command.excludeFromContext,
          })
        }
        return {
          replaced: false,
          response: successResponse({
            type: 'response',
            command: 'bash',
            success: true,
            data: result,
          }),
        }
      }
      case 'abort_bash':
        session.abortBash()
        return { replaced: false, response: noDataSuccess('abort_bash') }
      case 'get_session_stats':
        return {
          replaced: false,
          response: successResponse({
            type: 'response',
            command: 'get_session_stats',
            success: true,
            data: session.getSessionStats(),
          }),
        }
      case 'export_html': {
        const path = await session.exportToHtml(command.outputPath)
        return {
          replaced: false,
          response: successResponse({
            type: 'response',
            command: 'export_html',
            success: true,
            data: { path },
          }),
        }
      }
      case 'switch_session': {
        const result = await runtime.switchSession(command.sessionPath)
        return {
          replaced: !result.cancelled,
          response: successResponse({
            type: 'response',
            command: 'switch_session',
            success: true,
            data: result,
          }),
        }
      }
      case 'fork': {
        const result = await runtime.fork(command.entryId)
        return {
          replaced: !result.cancelled,
          response: successResponse({
            type: 'response',
            command: 'fork',
            success: true,
            data: { text: result.selectedText ?? '', cancelled: result.cancelled },
          }),
        }
      }
      case 'clone': {
        const leafId = session.sessionManager.getLeafId()
        if (!leafId) {
          return {
            replaced: false,
            response: failedResponse(
              'clone',
              'Cannot clone session: no current entry selected.',
            ),
          }
        }
        const result = await runtime.fork(leafId, { position: 'at' })
        return {
          replaced: !result.cancelled,
          response: successResponse({
            type: 'response',
            command: 'clone',
            success: true,
            data: { cancelled: result.cancelled },
          }),
        }
      }
      case 'get_fork_messages':
        return {
          replaced: false,
          response: successResponse({
            type: 'response',
            command: 'get_fork_messages',
            success: true,
            data: { messages: session.getUserMessagesForForking() },
          }),
        }
      case 'get_entries': {
        let entries = session.sessionManager.getEntries()
        if (command.since !== undefined) {
          const sinceIndex = entries.findIndex((entry) => entry.id === command.since)
          if (sinceIndex === -1) {
            return {
              replaced: false,
              response: failedResponse(
                'get_entries',
                `Entry not found: ${command.since}`,
              ),
            }
          }
          entries = entries.slice(sinceIndex + 1)
        }
        return {
          replaced: false,
          response: successResponse({
            type: 'response',
            command: 'get_entries',
            success: true,
            data: { entries, leafId: session.sessionManager.getLeafId() },
          }),
        }
      }
      case 'get_tree':
        return {
          replaced: false,
          response: successResponse({
            type: 'response',
            command: 'get_tree',
            success: true,
            data: {
              tree: session.sessionManager.getTree(),
              leafId: session.sessionManager.getLeafId(),
            },
          }),
        }
      case 'get_last_assistant_text':
        return {
          replaced: false,
          response: successResponse({
            type: 'response',
            command: 'get_last_assistant_text',
            success: true,
            data: { text: session.getLastAssistantText() ?? null },
          }),
        }
      case 'set_session_name': {
        const name = command.name.trim()
        if (!name) {
          return {
            replaced: false,
            response: failedResponse(
              'set_session_name',
              'Session name cannot be empty.',
            ),
          }
        }
        session.setSessionName(name)
        return { replaced: false, response: noDataSuccess('set_session_name') }
      }
      case 'get_messages':
        return { replaced: false, response: getMessages(runtime) }
      case 'get_commands':
        return { replaced: false, response: getCommands(runtime) }
      case 'get_command_argument_completions':
        return {
          replaced: false,
          response: successResponse({
            type: 'response',
            command: 'get_command_argument_completions',
            success: true,
            data: {
              items: await getRuntimeCommandArgumentCompletions(runtime, command),
            },
          }),
        }
    }
  } catch (error) {
    return { replaced: false, response: failedResponse(command.type, error) }
  }
}
