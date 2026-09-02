import { createServer, type Server } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

interface PiSdkFixtureOptions {
  agentDir: string
  globalPackages?: readonly string[]
  completionDelays?: Readonly<Record<string, number>>
  promptDelays?: Readonly<Record<string, number>>
  reasoningDelays?: Readonly<Record<string, number>>
  retryEnabled?: boolean
  writeToolPrompts?: Readonly<Record<string, {
    path: string
    content: string
  }>>
}

export interface PiSdkFixture {
  env: NodeJS.ProcessEnv
  prompts: string[]
  close(): Promise<void>
}

function messageText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((part) => (
      typeof part === 'object' && part !== null &&
      'type' in part && part.type === 'text' &&
      'text' in part && typeof part.text === 'string'
        ? part.text
        : ''
    ))
    .join('')
}

function latestUserPrompt(body: unknown): string {
  if (
    typeof body !== 'object' || body === null ||
    !('messages' in body) || !Array.isArray(body.messages)
  ) return ''
  for (let index = body.messages.length - 1; index >= 0; index -= 1) {
    const message = body.messages[index]
    if (
      typeof message === 'object' && message !== null &&
      'role' in message && message.role === 'user' &&
      'content' in message
    ) return messageText(message.content)
  }
  return ''
}

function hasToolResult(body: unknown, toolCallId: string): boolean {
  if (
    typeof body !== 'object' || body === null ||
    !('messages' in body) || !Array.isArray(body.messages)
  ) return false
  return body.messages.some((message) => (
    typeof message === 'object' && message !== null &&
    'role' in message && message.role === 'tool' &&
    'tool_call_id' in message && message.tool_call_id === toolCallId
  ))
}

function delay(milliseconds: number) {
  return new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds)
  })
}

async function closeServer(server: Server) {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose())
  })
}

/**
 * Real Pi SDK Electron fixture.
 *
 * The app still imports and runs the bundled SDK in utilityProcess. Only the
 * provider endpoint and user resources are deterministic: an isolated Pi
 * Agent directory contains official models/settings/extension/skill files,
 * while a local OpenAI-compatible SSE server supplies model responses.
 */
export async function startPiSdkFixture(
  options: PiSdkFixtureOptions,
): Promise<PiSdkFixture> {
  const prompts: string[] = []
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      void (async () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
        const prompt = latestUserPrompt(body)
        prompts.push(prompt)
        const promptDelay = options.promptDelays?.[prompt] ?? 0
        if (promptDelay > 0) await delay(promptDelay)
        const model = typeof body === 'object' && body !== null &&
          'model' in body && typeof body.model === 'string'
          ? body.model
          : 'fake-chat'
        const content = `Fixture response: ${prompt}`
        const created = Math.floor(Date.now() / 1_000)
        response.writeHead(200, {
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'content-type': 'text/event-stream',
        })
        const writeTool = options.writeToolPrompts?.[prompt]
        const writeToolCallId = 'call_pipilot_fixture_write'
        if (writeTool && !hasToolResult(body, writeToolCallId)) {
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-pipilot-fixture-write',
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: writeToolCallId,
                  type: 'function',
                  function: {
                    name: 'write',
                    arguments: JSON.stringify(writeTool),
                  },
                }],
              },
              finish_reason: null,
            }],
          })}\n\n`)
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-pipilot-fixture-write',
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 8,
              total_tokens: 20,
            },
          })}\n\n`)
          response.end('data: [DONE]\n\n')
          return
        }
        const reasoningDelay = options.reasoningDelays?.[prompt]
        if (reasoningDelay !== undefined) {
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-pipilot-fixture',
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                reasoning_content: `Fixture reasoning: ${prompt}`,
              },
              finish_reason: null,
            }],
          })}\n\n`)
          if (reasoningDelay > 0) await delay(reasoningDelay)
        }
        response.write(`data: ${JSON.stringify({
          id: 'chatcmpl-pipilot-fixture',
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{
            index: 0,
            delta: { role: 'assistant', content },
            finish_reason: null,
          }],
        })}\n\n`)
        const completionDelay = options.completionDelays?.[prompt] ?? 0
        if (completionDelay > 0) await delay(completionDelay)
        response.write(`data: ${JSON.stringify({
          id: 'chatcmpl-pipilot-fixture',
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 8,
            total_tokens: 20,
          },
        })}\n\n`)
        response.end('data: [DONE]\n\n')
      })().catch((error) => {
        response.writeHead(500, { 'content-type': 'text/plain' })
        response.end(error instanceof Error ? error.message : 'Fixture failure')
      })
    })
  })
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}/v1`

  await Promise.all([
    mkdir(join(options.agentDir, 'extensions'), { recursive: true }),
    mkdir(join(options.agentDir, 'skills', 'fixture-skill'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(options.agentDir, 'models.json'), `${JSON.stringify({
      providers: {
        fixture: {
          baseUrl,
          api: 'openai-completions',
          apiKey: 'fixture-key',
          compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
          },
          models: [
            {
              id: 'fake-chat',
              name: 'Fake Chat',
              reasoning: false,
              input: ['text', 'image'],
              contextWindow: 1_000_000,
              maxTokens: 128_000,
              cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
            },
            {
              id: 'fake-fast',
              name: 'Fake Fast',
              reasoning: false,
              input: ['text', 'image'],
              contextWindow: 500_000,
              maxTokens: 64_000,
              cost: { input: 0.5, output: 1, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    }, null, 2)}\n`, 'utf8'),
    writeFile(join(options.agentDir, 'settings.json'), `${JSON.stringify({
      defaultProvider: 'fixture',
      defaultModel: 'fake-chat',
      defaultProjectTrust: 'always',
      ...(options.globalPackages?.length
        ? { packages: [...options.globalPackages] }
        : {}),
      retry: {
        enabled: options.retryEnabled ?? false,
        maxRetries: options.retryEnabled ? 3 : 0,
        baseDelayMs: 10,
      },
    }, null, 2)}\n`, 'utf8'),
    writeFile(
      join(options.agentDir, 'skills', 'fixture-skill', 'SKILL.md'),
      '---\nname: fixture-skill\ndescription: Deterministic Electron fixture Skill.\n---\n\nUse the fixture skill.\n',
      'utf8',
    ),
    writeFile(join(options.agentDir, 'extensions', 'pipilot-e2e.js'), `
export default function pipilotE2eExtension(pi) {
  pi.registerCommand('fixture-command', {
    description: 'Run the deterministic PiPilot fixture command.',
    handler: async (_args, ctx) => {
      ctx.ui.notify('Fixture command ran', 'info')
    },
  })

  pi.registerCommand('fixture-silent-command', {
    description: 'Run a deterministic command without transcript or UI output.',
    handler: async () => {},
  })

  pi.registerCommand('fixture-options-command', {
    description: 'Expose deterministic command argument completions.',
    getArgumentCompletions: (prefix) => [
      { value: 'resume', label: 'Resume', description: 'Resume the fixture operation' },
      { value: 'restart', label: 'Restart', description: 'Restart the fixture operation' },
      { value: 'status', label: 'Status', description: 'Inspect the fixture operation' },
    ].filter((item) => item.value.startsWith(prefix)),
    handler: async () => {},
  })

  pi.on('session_start', async (_event, ctx) => {
    const delay = Number(process.env.PIPILOT_E2E_STARTUP_DELAY_MS || 0)
    if (Number.isFinite(delay) && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    if (process.env.PIPILOT_E2E_STARTUP_SURFACES === '1') {
      ctx.ui.notify('Startup fixture notification', 'info')
      ctx.ui.setWidget('startup', ['Startup fixture widget'])
      ctx.ui.setStatus('startup', 'startup: ready')
      ctx.ui.setTitle('Startup fixture title')
      ctx.ui.setEditorText('startup extension draft')
      }
  })

  pi.registerCommand('fixture-host-failure', {
    description: 'Trigger one deterministic embedded Host failure.',
    handler: async (_args, ctx) => {
      const marker = process.env.PIPILOT_E2E_HOST_FAILURE_MARKER
      if (!marker) return
      const fs = await import('node:fs')
      if (fs.existsSync(marker)) return
      fs.writeFileSync(marker, 'triggered\\n', 'utf8')
      ctx.shutdown()
    },
  })

  pi.on('before_agent_start', async (event, ctx) => {
    const acceptanceDelayPrompt = process.env.PIPILOT_E2E_ACCEPTANCE_DELAY_PROMPT
    const acceptanceDelay = Number(process.env.PIPILOT_E2E_ACCEPTANCE_DELAY_MS || 0)
    if (
      event.prompt === acceptanceDelayPrompt &&
      Number.isFinite(acceptanceDelay) &&
      acceptanceDelay > 0
    ) {
      await new Promise((resolve) => setTimeout(resolve, acceptanceDelay))
    }
    if (
      process.env.PIPILOT_E2E_UI_SURFACES === '1' &&
      event.prompt === 'ui'
    ) {
      const confirmed = await ctx.ui.confirm('Continue?', 'Continue?')
      if (confirmed) {
        ctx.ui.notify('Fixture notification', 'info')
        ctx.ui.setStatus('fixture', 'fixture: ready')
        ctx.ui.setWidget('fixture', ['Fixture widget', 'ready'])
      }
    }
  })
}
`, 'utf8'),
  ])

  return {
    env: {
      PI_CODING_AGENT_DIR: options.agentDir,
      PI_OFFLINE: '1',
      PI_SKIP_VERSION_CHECK: '1',
      PI_TELEMETRY: '0',
    },
    prompts,
    close: () => closeServer(server),
  }
}
