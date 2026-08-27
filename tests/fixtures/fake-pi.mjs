#!/usr/bin/env node

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--version')) {
  if (process.env.FAKE_PI_HANG_VERSION === '1') {
    process.on('SIGTERM', () => undefined)
    setInterval(() => undefined, 1_000)
    await new Promise(() => undefined)
  }
  process.stdout.write(`${process.env.FAKE_PI_VERSION ?? '0.84.1'}\n`)
  process.exit(0)
}

if (process.env.FAKE_PI_IGNORE_TERMINATION === '1') {
  process.on('SIGTERM', () => undefined)
  setInterval(() => undefined, 1_000)
}

const traceFile = process.env.FAKE_PI_TRACE
if (traceFile) {
  await appendFile(traceFile, `${JSON.stringify({ args, cwd: process.cwd() })}\n`)
}
const commandTraceFile = process.env.FAKE_PI_COMMAND_TRACE
if (process.env.FAKE_PI_STDERR) process.stderr.write(process.env.FAKE_PI_STDERR)

let pending = ''
const sessionIndex = args.indexOf('--session')
const explicitSession = sessionIndex !== -1
const forkIndex = args.indexOf('--fork')
const explicitFork = forkIndex !== -1
const forkSource = explicitFork ? resolve(args[forkIndex + 1]) : undefined
const fakeAgentDir = process.env.FAKE_PI_AGENT_DIR
const resolvedCwd = resolve(process.cwd())
const encodedCwd = `--${resolvedCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
const defaultSessionDirectory = fakeAgentDir
  ? join(fakeAgentDir, 'sessions', encodedCwd)
  : join(process.cwd(), '.pi', 'agent', 'sessions')
const sessionFile = explicitSession
  ? args[sessionIndex + 1]
  : join(defaultSessionDirectory, explicitFork ? 'fake-fork.jsonl' : 'fake.jsonl')
const selectedSessionFixture = sessionIndex !== -1 &&
  process.env.FAKE_PI_SELECTED_SESSION_FIXTURE === '1'

if (explicitFork) {
  const sourceEntries = (await readFile(forkSource, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const sourceHeader = sourceEntries.find((entry) => entry.type === 'session')
  if (!sourceHeader) throw new Error('The fake fork source has no session header.')
  const childHeader = {
    type: 'session',
    version: 3,
    id: 'fake-fork-session',
    timestamp: new Date().toISOString(),
    cwd: resolvedCwd,
    parentSession: forkSource,
  }
  await mkdir(dirname(sessionFile), { recursive: true })
  await writeFile(sessionFile, `${[
    childHeader,
    ...sourceEntries.filter((entry) => entry.type !== 'session'),
  ].map((entry) => JSON.stringify(entry)).join('\n')}\n`, { flag: 'wx' })
}

let openedSessionId
if (explicitSession) {
  try {
    const header = JSON.parse((await readFile(sessionFile, 'utf8')).split('\n')[0])
    if (header?.type === 'session' && typeof header.id === 'string') {
      openedSessionId = header.id
    }
  } catch {
    // Existing host tests also exercise future/nonexistent session paths.
  }
}

const PLAN_MODE_SOURCE = 'npm:@narumitw/pi-plan-mode@0.50.1'
const PLAN_FIXTURE_MARKDOWN = `# Adapter plan

1. Validate the public Plan completion.
2. Keep Retry owned by Pi.`

function sourceInfo(path, source, scope, origin = 'top-level') {
  return {
    path,
    source,
    scope,
    origin,
  }
}

const models = [
  {
    id: 'fake-chat',
    name: 'Fake Chat',
    api: 'anthropic-messages',
    provider: 'fake-provider',
    baseUrl: 'https://example.invalid',
    reasoning: true,
    input: ['text', 'image'],
    cost: {
      input: 1,
      output: 2,
      cacheRead: 0.1,
      cacheWrite: 0.2,
    },
    contextWindow: 128_000,
    maxTokens: 16_384,
  },
  {
    id: 'fake-fast',
    name: 'Fake Fast',
    api: 'anthropic-messages',
    provider: 'fake-provider',
    baseUrl: 'https://example.invalid',
    reasoning: false,
    input: ['text'],
    cost: {
      input: 0.5,
      output: 1,
      cacheRead: 0.05,
      cacheWrite: 0.1,
    },
    contextWindow: 64_000,
    maxTokens: 8_192,
  },
]

const unknownModel = {
  id: 'unknown',
  name: 'unknown',
  api: 'unknown',
  provider: 'unknown',
  baseUrl: '',
  reasoning: false,
  input: [],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 0,
  maxTokens: 0,
}

const zeroUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
}

let selectedModel = process.env.FAKE_PI_UNKNOWN_MODEL === '1'
  ? unknownModel
  : models[selectedSessionFixture ? 1 : 0]
let thinkingLevel = 'medium'
let currentSessionFile = sessionFile
let currentSessionId = explicitFork
  ? 'fake-fork-session'
  : openedSessionId ?? 'fake-session'
let currentSessionName = selectedSessionFixture
  ? 'Selected session fixture'
  : `fake session name`
let sessionSequence = 1
let steeringMode = 'all'
let followUpMode = 'one-at-a-time'
let autoCompactionEnabled = true
let streaming = false
let activeBash = null
let activeRetry = null
let sessionEventBurstSent = false
let steering = selectedSessionFixture ? ['Restored steer'] : []
let followUp = selectedSessionFixture ? ['Restored queue'] : []
let messages = selectedSessionFixture
  ? [
      { role: 'user', content: 'Selected session history prompt', timestamp: 3 },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Selected session history response' }],
        api: selectedModel.api,
        provider: selectedModel.provider,
        model: selectedModel.id,
        usage: zeroUsage,
        stopReason: 'stop',
        timestamp: 4,
      },
    ]
  : [
      { role: 'user', content: 'Fixture history prompt', timestamp: 1 },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Fixture history response' }],
        api: selectedModel.api,
        provider: selectedModel.provider,
        model: selectedModel.id,
        usage: zeroUsage,
        stopReason: 'stop',
        timestamp: 2,
      },
    ]

async function traceCommand(command) {
  if (!commandTraceFile) return
  await appendFile(commandTraceFile, `${JSON.stringify({
    kind: 'command',
    command,
    explicitSession,
    explicitFork,
    forkSource,
    sessionFile: currentSessionFile,
  })}\n`)
}

function send(value, split = process.env.FAKE_PI_SPLIT === '1') {
  const output = Buffer.from(`${JSON.stringify(value)}\n`)
  if (!split) {
    process.stdout.write(output)
    return
  }
  for (const byte of output) process.stdout.write(Buffer.from([byte]))
}

function response(command, data) {
  const value = {
    type: 'response',
    id: command.id,
    command: command.type,
    success: true,
    ...(data === undefined ? {} : { data }),
  }
  const selectedHydrationDelay = selectedSessionFixture && [
    'get_state',
    'get_messages',
    'get_available_models',
    'get_available_thinking_levels',
    'get_commands',
    'get_session_stats',
  ].includes(command.type)
    ? Number(process.env.FAKE_PI_SELECTED_HYDRATION_DELAY_MS ?? 0)
    : 0
  const startupHydrationDelay = !explicitSession && command.type === 'get_state'
    ? Number(process.env.FAKE_PI_STARTUP_HYDRATION_DELAY_MS ?? 0)
    : 0
  const promptDelay = command.type === 'prompt' &&
    command.message === process.env.FAKE_PI_DELAYED_PROMPT_MESSAGE
    ? Number(process.env.FAKE_PI_PROMPT_DELAY_MS ?? 0)
    : 0
  const delay = command.type === 'abort'
      ? Number(process.env.FAKE_PI_ABORT_DELAY_MS ?? 0)
      : command.type === 'get_last_assistant_text'
        ? Number(process.env.FAKE_PI_LAST_TEXT_DELAY_MS ?? 0)
        : Math.max(startupHydrationDelay, selectedHydrationDelay, promptDelay)
  if (delay > 0) setTimeout(() => send(value), delay)
  else send(value)
}

function assistantMessage(text, stopReason = 'stop') {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: selectedModel.api,
    provider: selectedModel.provider,
    model: selectedModel.id,
    usage: zeroUsage,
    stopReason,
    timestamp: Date.now(),
  }
}

function fixtureSessionEntries() {
  return [
    {
      type: 'message',
      id: 'fixture-entry-user',
      parentId: null,
      timestamp: '2026-08-09T00:00:00.000Z',
      message: {
        role: 'user',
        content: 'Fixture Agent entry',
        timestamp: 1,
      },
    },
    {
      type: 'message',
      id: 'fixture-entry-assistant',
      parentId: 'fixture-entry-user',
      timestamp: '2026-08-09T00:00:01.000Z',
      message: assistantMessage('Fixture Agent leaf'),
    },
  ]
}

function finishBash(active, result) {
  if (active.timer) clearTimeout(active.timer)
  if (activeBash?.command.id === active.command.id) activeBash = null
  response(active.command, result)
}

function emitCompletedTurn(command) {
  const user = {
    role: 'user',
    content: command.message,
    timestamp: Date.now(),
  }
  const assistant = assistantMessage(`Fixture response: ${command.message}`)
  messages = [...messages, user, assistant]
  send({ type: 'turn_start' })
  send({
    type: 'message_start',
    message: assistantMessage('', 'pending'),
  })
  send({
    type: 'message_update',
    usage: zeroUsage,
    assistantMessageEvent: {
      type: 'text_start',
      contentIndex: 0,
    },
  })
  send({
    type: 'message_update',
    usage: zeroUsage,
    assistantMessageEvent: {
      type: 'text_delta',
      contentIndex: 0,
      delta: `Fixture response: ${command.message}`,
    },
  })
  send({
    type: 'message_update',
    usage: zeroUsage,
    assistantMessageEvent: {
      type: 'text_end',
      contentIndex: 0,
      content: `Fixture response: ${command.message}`,
    },
  })
  send({ type: 'message_end', message: assistant })
  send({ type: 'turn_end', message: assistant, toolResults: [] })
  send({ type: 'agent_end', messages: [assistant], willRetry: false })
}

function emitPlanTurn(command) {
  const timestamp = Date.now()
  const user = { role: 'user', content: command.message, timestamp }
  const assistant = {
    ...assistantMessage('', 'stop'),
    content: [{
      type: 'toolCall',
      id: 'fixture-plan-call',
      name: 'plan_mode_complete',
      arguments: { plan: PLAN_FIXTURE_MARKDOWN },
    }],
    timestamp: timestamp + 1,
  }
  const toolResult = {
    role: 'toolResult',
    toolCallId: 'fixture-plan-call',
    toolName: 'plan_mode_complete',
    content: [{ type: 'text', text: 'Plan proposed.' }],
    details: {
      version: 1,
      source: 'plan_mode_complete',
      plan: PLAN_FIXTURE_MARKDOWN,
    },
    isError: false,
    timestamp: timestamp + 2,
  }
  messages = [...messages, user, assistant, toolResult]
  send({ type: 'turn_start' })
  send({
    type: 'tool_execution_start',
    toolCallId: 'fixture-plan-call',
    toolName: 'plan_mode_complete',
    args: { plan: PLAN_FIXTURE_MARKDOWN },
  })
  send({
    type: 'tool_execution_end',
    toolCallId: 'fixture-plan-call',
    toolName: 'plan_mode_complete',
    result: {
      content: [{ type: 'text', text: 'Plan proposed.' }],
      details: toolResult.details,
    },
    isError: false,
  })
  send({ type: 'message_end', message: assistant })
  send({ type: 'message_end', message: toolResult })
  send({
    type: 'extension_ui_request',
    id: 'fixture-plan-status',
    method: 'setStatus',
    statusKey: 'plan-mode',
    statusText: 'plan ready',
  })
  send({
    type: 'extension_ui_request',
    id: 'fixture-plan-widget',
    method: 'setWidget',
    widgetKey: 'plan-mode-plan',
    widgetLines: [
      'Proposed plan ready',
      'Use /plan to implement, save, revise, or exit Plan mode.',
    ],
    widgetPlacement: 'aboveEditor',
  })
  send({ type: 'turn_end', message: assistant, toolResults: [toolResult] })
  send({ type: 'agent_end', messages: [assistant, toolResult], willRetry: false })
}

function startRetryFixture(command, recover) {
  activeRetry = { attempt: 1 }
  send({
    type: 'auto_retry_start',
    attempt: 1,
    maxAttempts: 3,
    delayMs: 5_000,
    errorMessage: 'Fixture provider overloaded',
  })
  send({
    type: 'extension_ui_request',
    id: 'fixture-retry-status',
    method: 'setStatus',
    statusKey: 'retry',
    statusText: 'retrying',
  })
  if (!recover) return
  setTimeout(() => {
    if (!activeRetry) return
    activeRetry = null
    send({ type: 'auto_retry_end', success: true, attempt: 1 })
    send({
      type: 'extension_ui_request',
      id: 'fixture-retry-status-clear',
      method: 'setStatus',
      statusKey: 'retry',
    })
    emitCompletedTurn(command)
    streaming = false
    send({ type: 'agent_settled' })
  }, 250)
}

function sessionState() {
  return {
    model: selectedModel,
    thinkingLevel,
    isStreaming: streaming,
    isCompacting: false,
    steeringMode,
    followUpMode,
    sessionFile: currentSessionFile,
    sessionId: currentSessionId,
    sessionName: currentSessionName,
    autoCompactionEnabled,
    messageCount: messages.length,
    pendingMessageCount: steering.length + followUp.length,
  }
}

function sessionStats() {
  const userMessages = messages.filter((message) => message.role === 'user').length
  const assistantMessages = messages.filter((message) => message.role === 'assistant').length
  return {
    sessionFile: currentSessionFile,
    sessionId: currentSessionId,
    userMessages,
    assistantMessages,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: messages.length,
    tokens: {
      input: 1_200,
      output: 300,
      cacheRead: 100,
      cacheWrite: 0,
      total: 1_600,
    },
    cost: selectedSessionFixture ? 0.875 : 0.125,
    contextUsage: {
      tokens: 1_600,
      contextWindow: selectedModel.contextWindow,
      percent: 1.25,
    },
  }
}

async function handle(command) {
  await traceCommand(command)
  if (command.type === 'extension_ui_response') return
  if (process.env.FAKE_PI_OVERSIZED_ON === command.type) {
    const bytes = Number(process.env.FAKE_PI_OVERSIZED_BYTES ?? 2_048)
    process.stdout.write(`${JSON.stringify({ oversized: 'x'.repeat(bytes) })}\n`)
    return
  }
  if (process.env.FAKE_PI_MALFORMED_ON === command.type) {
    process.stdout.write('{malformed\n')
    return
  }
  if (process.env.FAKE_PI_INVALID_RESPONSE_ON === command.type) {
    send({
      type: 'response',
      id: command.id,
      command: command.type,
      success: true,
      data: { invalid: true },
    })
    return
  }
  if (command.type === 'get_state') {
    response(command, sessionState())
    const eventBurstCount = Number(process.env.FAKE_PI_SESSION_EVENT_BURST ?? 0)
    if (
      selectedSessionFixture &&
      !sessionEventBurstSent &&
      Number.isInteger(eventBurstCount) &&
      eventBurstCount > 0
    ) {
      sessionEventBurstSent = true
      setTimeout(() => {
        for (let index = 0; index < eventBurstCount; index += 1) {
          send({
            type: 'session_info_changed',
            name: currentSessionName,
          })
        }
      }, 50)
    }
    return
  }
  if (command.type === 'get_commands') {
    const projectCommandPath = join(process.cwd(), '.pi', 'fake-project-command')
    const fixtureSkillName = selectedSessionFixture
      ? 'selected-fixture-skill'
      : 'fixture-skill'
    let projectCommand = null
    try {
      projectCommand = (await readFile(projectCommandPath, 'utf8')).trim()
    } catch {
      // Optional project fixture.
    }
    response(command, {
      commands: [
        ...(process.env.FAKE_PI_ENABLE_SKILL_COMMANDS === '1'
          ? [
              {
                name: 'fixture-command',
                description: 'Run the fixture prompt command',
                source: 'prompt',
                sourceInfo: sourceInfo(
                  join(process.cwd(), '.pi', 'prompts', 'fixture-command.md'),
                  'fixture-command',
                  'project',
                ),
              },
              {
                name: `skill:${fixtureSkillName}`,
                description: 'Use the fixture skill',
                source: 'skill',
                sourceInfo: sourceInfo(
                  join(process.cwd(), '.pi', 'skills', fixtureSkillName, 'SKILL.md'),
                  fixtureSkillName,
                  'project',
                ),
              },
            ]
          : []),
        ...(process.env.FAKE_PI_ENABLE_UI_COMMAND === '1'
          ? [{
              name: 'fake-ui',
              description: 'Exercise the fake extension UI',
              source: 'extension',
              sourceInfo: sourceInfo(
                join(process.cwd(), '.pi', 'extensions', 'fake-ui.ts'),
                'fake-ui',
                'temporary',
              ),
            }]
          : []),
        ...(process.env.FAKE_PI_GLOBAL_COMMAND
          ? [{
              name: process.env.FAKE_PI_GLOBAL_COMMAND,
              source: 'extension',
              sourceInfo: sourceInfo(
                join(process.cwd(), '.pi', 'global-fixture.ts'),
                process.env.FAKE_PI_GLOBAL_COMMAND,
                'user',
              ),
            }]
          : []),
        ...(process.env.FAKE_PI_RICH_ADAPTERS === '1'
          ? [{
              name: 'plan',
              description: 'Plan Mode fixture',
              source: 'extension',
              sourceInfo: sourceInfo(
                join(process.cwd(), '.pi', 'packages', 'plan-mode', 'src', 'plan-mode.ts'),
                PLAN_MODE_SOURCE,
                'user',
                'package',
              ),
            }]
          : []),
        ...(projectCommand
          ? [{
              name: projectCommand,
              source: 'extension',
              sourceInfo: sourceInfo(projectCommandPath, projectCommand, 'project'),
            }]
          : []),
      ],
    })
    return
  }
  if (command.type === 'prompt') {
    response(command)
    streaming = true
    send({ type: 'agent_start' })
    if (command.message === 'hold') return
    if (
      process.env.FAKE_PI_RICH_ADAPTERS === '1' &&
      command.message === 'plan-fixture'
    ) {
      emitPlanTurn(command)
    } else if (
      process.env.FAKE_PI_RICH_ADAPTERS === '1' &&
      (command.message === 'retry-fixture' || command.message === 'retry-recover-fixture')
    ) {
      startRetryFixture(command, command.message === 'retry-recover-fixture')
      return
    } else {
      emitCompletedTurn(command)
    }
    if (command.message === 'ui') {
      send({
        type: 'extension_ui_request',
        id: 'ui-1',
        method: 'confirm',
        title: 'Continue?',
        message: 'Choose a value',
      })
      if (process.env.FAKE_PI_UI_SURFACES === '1') {
        send({
          type: 'extension_ui_request',
          id: 'ui-notify',
          method: 'notify',
          message: 'Fixture notification',
          notifyType: 'info',
        })
        send({
          type: 'extension_ui_request',
          id: 'ui-status',
          method: 'setStatus',
          statusKey: 'fixture',
          statusText: '\u001b[38;5;40mready\u001b[0m',
        })
        send({
          type: 'extension_ui_request',
          id: 'ui-widget',
          method: 'setWidget',
          widgetKey: 'fixture',
          widgetLines: ['Fixture widget'],
          widgetPlacement: 'aboveEditor',
        })
        send({
          type: 'extension_ui_request',
          id: 'ui-title',
          method: 'setTitle',
          title: 'Fixture title',
        })
        send({
          type: 'extension_ui_request',
          id: 'ui-editor',
          method: 'set_editor_text',
          text: 'extension draft',
        })
      }
    }
    streaming = false
    queueMicrotask(() => send({ type: 'agent_settled' }))
    return
  }
  if (command.type === 'follow_up') {
    followUp = [...followUp, command.message]
    response(command)
    send({ type: 'queue_update', steering, followUp })
    return
  }
  if (command.type === 'steer') {
    steering = [...steering, command.message]
    response(command)
    send({ type: 'queue_update', steering, followUp })
    return
  }
  if (command.type === 'abort') {
    response(command)
    streaming = false
    steering = []
    followUp = []
    send({ type: 'queue_update', steering, followUp })
    send({ type: 'agent_settled' })
    return
  }
  if (command.type === 'set_auto_retry') {
    response(command)
    return
  }
  if (command.type === 'abort_retry') {
    response(command)
    if (activeRetry) {
      const attempt = activeRetry.attempt
      activeRetry = null
      send({
        type: 'auto_retry_end',
        success: false,
        attempt,
        finalError: 'Fixture retry cancelled',
      })
      send({
        type: 'extension_ui_request',
        id: 'fixture-retry-status-clear',
        method: 'setStatus',
        statusKey: 'retry',
      })
      streaming = false
      send({ type: 'agent_settled' })
    }
    return
  }
  if (command.type === 'bash') {
    if (activeBash) {
      send({
        type: 'response',
        id: command.id,
        command: command.type,
        success: false,
        error: 'A fixture bash command is already running',
      })
      return
    }
    const liveOutput = command.command === 'hold-bash'
      ? 'Fixture shell running\n'
      : `Fixture shell stream: ${command.command}\n`
    send({
      type: 'bash_execution_update',
      id: command.id,
      delta: liveOutput,
    })
    const active = {
      command,
      timer: null,
    }
    activeBash = active
    if (command.command === 'hold-bash') return
    const delay = command.command.startsWith('delay:')
      ? Number(command.command.slice('delay:'.length))
      : 0
    const result = {
      output: `Fixture shell result: ${command.command}\n`,
      exitCode: 0,
      cancelled: false,
      truncated: false,
    }
    if (delay > 0) {
      active.timer = setTimeout(() => finishBash(active, result), delay)
    } else {
      finishBash(active, result)
    }
    return
  }
  if (command.type === 'abort_bash') {
    const runningBash = activeBash
    response(command)
    if (runningBash) {
      finishBash(runningBash, {
        output: 'Fixture shell cancelled\n',
        cancelled: true,
        truncated: false,
      })
    }
    return
  }
  if (command.type === 'get_available_models') {
    response(command, { models })
    return
  }
  if (command.type === 'set_model') {
    const next = models.find((model) =>
      model.provider === command.provider && model.id === command.modelId)
    if (!next) {
      send({
        type: 'response',
        id: command.id,
        command: command.type,
        success: false,
        error: 'Unknown fixture model',
      })
      return
    }
    selectedModel = next
    response(command, selectedModel)
    return
  }
  if (command.type === 'cycle_model') {
    const index = models.indexOf(selectedModel)
    selectedModel = models[(index + 1) % models.length]
    response(command, {
      model: selectedModel,
      thinkingLevel,
      isScoped: false,
    })
    return
  }
  if (command.type === 'get_available_thinking_levels') {
    response(command, {
      levels: selectedModel.reasoning
        ? ['off', 'minimal', 'low', 'medium', 'high']
        : ['off'],
    })
    return
  }
  if (command.type === 'set_thinking_level') {
    thinkingLevel = command.level
    send({ type: 'thinking_level_changed', level: thinkingLevel })
    response(command)
    return
  }
  if (command.type === 'cycle_thinking_level') {
    const levels = ['off', 'minimal', 'low', 'medium', 'high']
    thinkingLevel = levels[(levels.indexOf(thinkingLevel) + 1) % levels.length]
    response(command, { level: thinkingLevel })
    return
  }
  if (command.type === 'set_steering_mode') {
    steeringMode = command.mode
    response(command)
    return
  }
  if (command.type === 'set_follow_up_mode') {
    followUpMode = command.mode
    response(command)
    return
  }
  if (command.type === 'set_auto_compaction') {
    autoCompactionEnabled = command.enabled
    response(command)
    return
  }
  if (command.type === 'compact') {
    response(command, {
      summary: 'Fixture compacted summary',
      firstKeptEntryId: 'fixture-entry',
      tokensBefore: 1_600,
      estimatedTokensAfter: 800,
    })
    return
  }
  if (command.type === 'get_session_stats') {
    response(command, sessionStats())
    return
  }
  if (command.type === 'new_session') {
    sessionSequence += 1
    currentSessionId = `fake-session-${sessionSequence}`
    currentSessionFile = undefined
    currentSessionName = undefined
    messages = []
    steering = []
    followUp = []
    response(command, { cancelled: false })
    return
  }
  if (command.type === 'fork') {
    const forkText = 'Fixture Agent entry'
    sessionSequence += 1
    currentSessionId = `fake-session-${sessionSequence}`
    currentSessionFile = join(dirname(sessionFile), `fake-session-${sessionSequence}.jsonl`)
    currentSessionName = undefined
    messages = []
    steering = []
    followUp = []
    await mkdir(dirname(currentSessionFile), { recursive: true })
    await writeFile(currentSessionFile, `${JSON.stringify({
      type: 'session',
      version: 3,
      id: currentSessionId,
      timestamp: new Date().toISOString(),
      cwd: resolvedCwd,
      parentSession: sessionFile,
    })}\n`)
    response(command, { text: forkText, cancelled: false })
    return
  }
  if (command.type === 'clone' || command.type === 'switch_session') {
    response(command, { cancelled: false })
    return
  }
  if (command.type === 'get_fork_messages') {
    response(command, {
      messages: [{ entryId: 'fixture-entry-user', text: 'Fixture Agent entry' }],
    })
    return
  }
  if (command.type === 'get_entries') {
    const entries = fixtureSessionEntries()
    const sinceIndex = command.since
      ? entries.findIndex((entry) => entry.id === command.since)
      : -1
    if (command.since && sinceIndex === -1) {
      send({
        type: 'response',
        id: command.id,
        command: command.type,
        success: false,
        error: `Entry not found: ${command.since}`,
      })
      return
    }
    response(command, {
      entries: command.since ? entries.slice(sinceIndex + 1) : entries,
      leafId: 'fixture-entry-assistant',
    })
    return
  }
  if (command.type === 'get_tree') {
    const entries = fixtureSessionEntries()
    const requestedDepth = Number(process.env.FAKE_PI_TREE_DEPTH ?? 2)
    const treeDepth = Number.isInteger(requestedDepth) && requestedDepth >= 2
      ? requestedDepth
      : 2
    const lastIntermediateId = treeDepth > 2
      ? `fixture-tree-${treeDepth - 2}`
      : entries[0].id
    let branch = {
      entry: {
        ...entries[1],
        parentId: lastIntermediateId,
      },
      children: [],
      label: 'Fixture branch',
      labelTimestamp: '2026-08-09T00:00:02.000Z',
    }
    for (let index = treeDepth - 2; index >= 1; index -= 1) {
      branch = {
        entry: {
          type: 'session_info',
          id: `fixture-tree-${index}`,
          parentId: index === 1 ? entries[0].id : `fixture-tree-${index - 1}`,
          timestamp: '2026-08-09T00:00:00.000Z',
          name: `Fixture tree node ${index}`,
        },
        children: [branch],
      }
    }
    response(command, {
      tree: [{
        entry: entries[0],
        children: [branch],
      }],
      leafId: 'fixture-entry-assistant',
    })
    return
  }
  if (command.type === 'get_messages') {
    response(command, { messages })
    return
  }
  if (command.type === 'get_last_assistant_text') {
    const last = [...messages].reverse().find((message) => message.role === 'assistant')
    response(command, {
      text: last?.content?.find((content) => content.type === 'text')?.text ?? null,
    })
    return
  }
  if (command.type === 'set_session_name') {
    currentSessionName = command.name.trim()
    send({ type: 'session_info_changed', name: currentSessionName })
    response(command)
    return
  }
  if (command.type === 'export_html') {
    response(command, { path: command.outputPath ?? join(process.cwd(), 'fake-session.html') })
    return
  }
  response(command)
}

if (process.env.FAKE_PI_STARTUP_UI_SURFACES === '1') {
  send({
    type: 'extension_ui_request',
    id: 'startup-notify',
    method: 'notify',
    message: 'Startup fixture notification',
    notifyType: 'info',
  })
  send({
    type: 'extension_ui_request',
    id: 'startup-status',
    method: 'setStatus',
    statusKey: 'startup',
    statusText: 'ready',
  })
  send({
    type: 'extension_ui_request',
    id: 'startup-widget',
    method: 'setWidget',
    widgetKey: 'startup',
    widgetLines: ['Startup fixture widget'],
    widgetPlacement: 'aboveEditor',
  })
  send({
    type: 'extension_ui_request',
    id: 'startup-title',
    method: 'setTitle',
    title: 'Startup fixture title',
  })
  send({
    type: 'extension_ui_request',
    id: 'startup-editor',
    method: 'set_editor_text',
    text: 'startup extension draft',
  })
}

process.stdin.on('data', (chunk) => {
  pending += chunk.toString('utf8')
  let lineFeed = pending.indexOf('\n')
  while (lineFeed !== -1) {
    const line = pending.slice(0, lineFeed).replace(/\r$/u, '')
    pending = pending.slice(lineFeed + 1)
    if (line) void handle(JSON.parse(line))
    lineFeed = pending.indexOf('\n')
  }
})
